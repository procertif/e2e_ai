const { sanitizeToolUseHistory } = require("./history");
const { correctionSystemBlocks } = require("./prompts");
const { collectToolResults } = require("./toolLoop");

// Lightweight sibling of the classic chat run, scoped to one test in
// correction — no conversationId/db persistence (the whole correction is
// draft-local and disappears with it), history lives directly on the
// correction entry instead of the in-memory LRU, and WriteTestFile/RunTest
// target that entry's draft (see the tools' ctx.correctionFilename branch).
module.exports = function createCorrectionRun({ client, executeTool, registry, environments, corrections, promptsConfig, scenarios }) {
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
			// The scenario's Gherkin spec is the test's contract: the fix must
			// preserve this behavior, not merely turn the run green.
			const spec = scenarios?.get(filename.replace(/\.spec\.ts$/, ""))?.spec;
			const specBlock = spec ? `\n\nRésultat attendu (spécification du scénario — la correction doit préserver ce comportement) :\n\`\`\`\n${spec}\n\`\`\`` : "";
			// contextStale: the entry was re-flagged by a newer campaign failure, or
			// the user edited the draft by hand since the conversation started — the
			// turn-1 snapshot no longer matches reality, so re-inject the current
			// draft + console output instead of letting old and new contexts mix.
			const contextStale = !isFirstTurn && Boolean(entry.contextStale);
			const userText = isFirstTurn
				? `[Contexte automatique] Ce test a échoué : ${filename}.\n\nCode actuel :\n\`\`\`typescript\n${entry.draftContent}\n\`\`\`\n\nSortie console de l'échec :\n\`\`\`\n${entry.consoleOutput || "(aucune sortie console capturée)"}\n\`\`\`${specBlock}\n\n${message || "Aide-moi à corriger ce test."}`
				: contextStale
					? `[Contexte automatique] Le contexte a changé depuis le début de cette conversation (nouvel échec de campagne ou modification manuelle du brouillon). Ignore les versions précédentes du code et de la sortie console : voici l'état actuel.\n\nCode actuel :\n\`\`\`typescript\n${entry.draftContent}\n\`\`\`\n\nDernière sortie console :\n\`\`\`\n${entry.consoleOutput || "(aucune sortie console capturée)"}\n\`\`\`\n\n${message || "Aide-moi à corriger ce test."}`
					: (message || " ");
			corrections.clearContextStale(filename);
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

			// The entry may have been validated/dismissed and re-created by a new
			// campaign while this run was in flight — saving onto that fresh entry
			// would resurrect a conversation about a previous incarnation of the
			// correction. Only save onto the exact entry this run started from.
			if (corrections.get(filename) === entry) {
				corrections.setChatMessages(filename, history);
			}
			registry.finishRun(run, pushEvent, { runId, status: stopped ? "stopped" : "done" });
		})().catch((err) => {
			registry.finishRun(run, pushEvent, { runId, status: "error", error: err.message });
		});

		return runId;
	}

	return { startCorrectionChatRun };
};
