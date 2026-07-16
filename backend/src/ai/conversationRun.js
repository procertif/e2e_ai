const { sanitizeToolUseHistory, sanitizeSeedHistory, capOversizedImages } = require("./history");
const { collectToolResults } = require("./toolLoop");
const { isSafeTestname } = require("../core/safeNames");

// The classic Chat run: one user message in, a full tool-use loop out,
// streamed as SSE events and logged to the chat_logs table.
module.exports = function createConversationRun({ db, client, executeTool, registry, environments }) {
	const chatHistories = new Map(); // sessionId -> messages[]

	async function persistChatLog(log) {
		try {
			await db.chatLog.create({
				data: {
					runId: log.runId,
					conversationId: log.conversationId || log.runId,
					startedAt: new Date(log.startedAt),
					endedAt: log.endedAt ? new Date(log.endedAt) : null,
					durationMs: log.durationMs,
					totals: JSON.stringify(log.error ? { ...log.totals, error: log.error } : log.totals),
					apiCalls: JSON.stringify(log.apiCalls),
					messages: JSON.stringify(log.messages || []),
				},
			});
		} catch (err) {
			console.error("[chat-log] Erreur d'enregistrement:", err.message || String(err));
		}
	}

	// A conversation spans multiple turns, each persisted under a fresh runId —
	// conversationId is the stable thread id, inherited from the previous
	// turn's row (looked up by its runId, which the client sends back as
	// sessionId) so /api/conversations can group turns without the client
	// having to know or send a separate id.
	async function resolveConversationId(sessionId, newRunId) {
		if (!sessionId) return newRunId;
		try {
			const prev = await db.chatLog.findFirst({ where: { runId: sessionId }, select: { conversationId: true } });
			return prev?.conversationId || sessionId;
		} catch {
			return newRunId;
		}
	}

	function rememberHistory(runId, history) {
		chatHistories.set(runId, history);
		if (chatHistories.size > 50) chatHistories.delete([...chatHistories.keys()][0]);
	}

	// Preserves the prompt history that produced each test whose action list
	// was written this run — regardless of whether the test ends up confirmed
	// or discarded. Scenario registration itself happens on confirm, in the
	// pending module.
	async function persistTestPrompts(history) {
		for (const msg of history) {
			if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block.type !== "tool_use" || block.name !== "WriteTestFile" || block.input?.kind !== "actions") continue;
				const testKey = block.input?.testname;
				if (!isSafeTestname(testKey)) continue;

				const userMessages = history
					.filter(m => m.role === "user" && !(Array.isArray(m.content) && m.content[0]?.type === "tool_result"))
					.map(m => ({ role: m.role, content: m.content }));
				await db.testPrompt.upsert({
					where: { testname: testKey },
					create: { testname: testKey, messagesJson: JSON.stringify(userMessages) },
					update: { messagesJson: JSON.stringify(userMessages) },
				});
			}
		}
	}

	// Images are redacted down to { type: "image", media_type } in the stored
	// log to keep chat_log rows small (see sanitizeSeedHistory for the resume
	// side of this contract).
	function redactImagesForLog(history) {
		return history.map(msg => ({
			role: msg.role,
			content: Array.isArray(msg.content)
				? msg.content.map(b => {
					if (b.type === "image") return { type: "image", media_type: b.source?.media_type };
					if (b.type === "tool_result" && Array.isArray(b.content)) {
						return { ...b, content: b.content.map(c => c.type === "image" ? { type: "image", media_type: c.source?.media_type } : c) };
					}
					return b;
				})
				: msg.content,
		}));
	}

	function startChatRun(message, images, sessionId, instructions, environmentId, seedHistory) {
		const { runId, run, pushEvent } = registry.createRun();
		const sessionStart = Date.now();
		const log = {
			runId,
			conversationId: null,
			startedAt: new Date(sessionStart).toISOString(),
			endedAt: null,
			durationMs: null,
			apiCalls: [],
			totals: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, apiCalls: 0, toolsCalled: 0 },
		};

		const environment = Number.isInteger(environmentId) ? environments.get(environmentId) : null;
		const history = (sessionId && chatHistories.get(sessionId)) || sanitizeSeedHistory(seedHistory) || [];

		(async () => {
			log.conversationId = await resolveConversationId(sessionId, runId);
			sanitizeToolUseHistory(history);
			const userContent = images && images.length > 0
				? [
					...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
					{ type: "text", text: message || " " },
				]
				: message;
			history.push({ role: "user", content: userContent });
			// After the push so a user-attached oversized image is capped too.
			await capOversizedImages(history);

			const token = await client.getOAuthToken();
			let continueLoop = true;
			let stopped = false;
			const controller = new AbortController();
			run.abort = () => controller.abort();

			try {
				while (continueLoop) {
					const callStart = Date.now();
					const { stopReason, content, usage } = await client.callClaudeStream(token, history, pushEvent, instructions, controller.signal);
					const callDuration = Date.now() - callStart;

					const toolsCalled = content.filter(b => b.type === "tool_use").map(b => ({ name: b.name, input: b.input }));
					log.apiCalls.push({ index: log.apiCalls.length + 1, startedAt: new Date(callStart).toISOString(), durationMs: callDuration, usage, toolsCalled });
					log.totals.apiCalls++;
					log.totals.toolsCalled += toolsCalled.length;
					for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
						log.totals[k] += usage[k] || 0;
					}

					history.push({ role: "assistant", content });

					if (stopReason === "tool_use") {
						const toolResults = await collectToolResults({
							content,
							executeTool,
							ctx: { environment, signal: controller.signal },
							pushEvent,
						});
						// Every tool already ran to completion above regardless of the
						// abort signal (tools aren't themselves abortable) — the
						// results must always be pushed. Discarding them would leave
						// the assistant turn's tool_use blocks permanently orphaned:
						// the Anthropic API hard-rejects (400) every future call on
						// this conversation once that happens. Abort only means
						// "don't start another model call after this."
						history.push({ role: "user", content: toolResults });
						if (controller.signal.aborted) {
							continueLoop = false;
							stopped = true;
						}
					} else {
						continueLoop = false;
					}
				}
			} catch (err) {
				if (err.name === "AbortError" || err.code === "ABORT_ERR") {
					stopped = true;
				} else {
					throw err;
				}
			}

			rememberHistory(runId, history);
			await persistTestPrompts(history);

			log.endedAt = new Date().toISOString();
			log.durationMs = Date.now() - sessionStart;
			log.messages = redactImagesForLog(history);
			await persistChatLog(log);

			registry.finishRun(run, pushEvent, { runId, status: stopped ? "stopped" : "done" });
		})().catch(async (err) => {
			rememberHistory(runId, history);
			log.endedAt = new Date().toISOString();
			log.durationMs = Date.now() - sessionStart;
			log.error = err.message;
			await persistChatLog(log);
			registry.finishRun(run, pushEvent, { runId, status: "error", error: err.message });
		});

		return runId;
	}

	return { startChatRun };
};
