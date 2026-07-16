const { sanitizeToolUseHistory } = require("./history");
const { correctionSystemBlocks } = require("./prompts");
const { collectToolResults } = require("./toolLoop");

// Lightweight sibling of the classic chat run, scoped to one test in
// correction — no conversationId/db persistence (the whole correction is
// draft-local and disappears with it), history lives directly on the
// correction entry instead of the in-memory LRU, and WriteTestFile/RunTest
// target that entry's draft (see the tools' ctx.correctionFilename branch).
module.exports = function createCorrectionRun({ client, executeTool, registry, environments, corrections, promptsConfig }) {
	function startCorrectionChatRun(filename, message, images, environmentId) {
		const entry = corrections.get(filename);
		if (!entry) throw new Error("This test is not in correction.");

		const { runId, run, pushEvent } = registry.createRun();

		// The task's own target environment (picked in the Corrections page at
		// enqueue time) wins; the environment of the campaign that flagged the
		// test is only the fallback. This is what lets two successive batches
		// run the same pending set against two different environments.
		const effectiveEnvId = environmentId ?? entry.environmentId;
		const environment = effectiveEnvId != null ? environments.get(effectiveEnvId) : null;
		const systemBlocks = promptsConfig ? promptsConfig.correctionBlocks(filename) : correctionSystemBlocks(filename);

		(async () => {
			const history = entry.chatMessages || [];
			sanitizeToolUseHistory(history);
			const isFirstTurn = history.length === 0;
			const userText = isFirstTurn
				? `[Contexte automatique] Ce test a échoué : ${filename}.\n\nCode actuel :\n\`\`\`typescript\n${entry.draftContent}\n\`\`\`\n\nSortie console de l'échec :\n\`\`\`\n${entry.consoleOutput || "(aucune sortie console capturée)"}\n\`\`\`\n\n${message || "Aide-moi à corriger ce test."}`
				: (message || " ");
			const userContent = images && images.length > 0
				? [
					...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
					{ type: "text", text: userText },
				]
				: userText;
			history.push({ role: "user", content: userContent });

			const token = await client.getOAuthToken();
			let continueLoop = true;
			let stopped = false;
			const controller = new AbortController();
			run.abort = () => controller.abort();

			try {
				while (continueLoop) {
					const { stopReason, content } = await client.callClaudeStream(token, history, pushEvent, null, controller.signal, systemBlocks);
					history.push({ role: "assistant", content });

					if (stopReason === "tool_use") {
						const toolResults = await collectToolResults({
							content,
							executeTool,
							ctx: { environment, correctionFilename: filename, corrections, signal: controller.signal },
							pushEvent,
						});
						// See the identical comment in conversationRun — results must
						// always be pushed, or the conversation 400s forever.
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

			corrections.setChatMessages(filename, history);
			registry.finishRun(run, pushEvent, { runId, status: stopped ? "stopped" : "done" });
		})().catch((err) => {
			registry.finishRun(run, pushEvent, { runId, status: "error", error: err.message });
		});

		return runId;
	}

	return { startCorrectionChatRun };
};
