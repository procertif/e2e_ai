const { sanitizeToolUseHistory, capOversizedImages } = require("./history");
const { creationSystemBlocks, environmentContext } = require("./prompts");
const { collectToolResults } = require("./toolLoop");

// Twin of correctionRun, scoped to one test being created from scratch on
// the Tests page. The creations repository exposes the exact same draft
// interface as corrections (get/updateDraft/setLastRunStatus), so the tools'
// existing draft branch (ctx.correctionFilename + ctx.corrections) is reused
// as-is — WriteTestFile edits the creation draft, RunTest executes it.
module.exports = function createCreationRun({ client, executeTool, registry, environments, creations, promptsConfig, scenarios }) {
	function startCreationChatRun(filename, message, images, environmentId) {
		const entry = creations.get(filename);
		if (!entry) throw new Error("This test is not in creation.");

		const { runId, run, pushEvent } = registry.createRun();

		// The task's target environment (picked on the Tests page at enqueue
		// time) wins; the environment the entry was created under is only the
		// fallback.
		const effectiveEnvId = environmentId ?? entry.environmentId;
		const environment = effectiveEnvId != null ? environments.get(effectiveEnvId) : null;
		const baseBlocks = promptsConfig ? promptsConfig.creationBlocks(filename) : creationSystemBlocks(filename);
		// Unlike corrections (whose tests were generated for a known target
		// already), a test being written from scratch needs the environment
		// contract up front — especially the getEnvironmentVariable rule that
		// keeps environment-specific values out of the spec.
		const systemBlocks = environment ? [...baseBlocks, { type: "text", text: environmentContext(environment) }] : baseBlocks;

		(async () => {
			const history = entry.chatMessages || [];
			sanitizeToolUseHistory(history);
			const isFirstTurn = history.length === 0;
			// A scenario written before its test (Scenarios page) is the test's
			// contract — inject it so the AI builds the test against it.
			const spec = scenarios?.get(filename.replace(/\.spec\.ts$/, ""))?.spec;
			const specBlock = spec ? `\n\nRésultat attendu (spécification du scénario — le test doit vérifier ce comportement) :\n\`\`\`\n${spec}\n\`\`\`` : "";
			const draftBlock = (entry.draftContent || "").trim()
				? `\n\nBrouillon actuel :\n\`\`\`typescript\n${entry.draftContent}\n\`\`\``
				: "\n\nAucun brouillon n'existe encore — le test est à écrire entièrement.";
			// contextStale: the user edited the draft by hand since the
			// conversation started — re-inject the current draft instead of
			// letting the AI reason on its own last-written version.
			const contextStale = !isFirstTurn && Boolean(entry.contextStale);
			const userText = isFirstTurn
				? `[Contexte automatique] Nouveau test à créer : ${filename}${entry.title ? ` (« ${entry.title} »)` : ""}.${specBlock}${draftBlock}\n\n${message || "Aide-moi à créer ce test."}`
				: contextStale
					? `[Contexte automatique] Le brouillon a été modifié manuellement depuis le début de cette conversation. Ignore les versions précédentes : voici l'état actuel.${draftBlock}\n\n${message || "Aide-moi à créer ce test."}`
					: (message || " ");
			creations.clearContextStale(filename);
			const userContent = images && images.length > 0
				? [
					...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
					{ type: "text", text: userText },
				]
				: userText;
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
					const { stopReason, content } = await client.callClaudeStream(token, history, pushEvent, null, controller.signal, systemBlocks);
					history.push({ role: "assistant", content });

					if (stopReason === "tool_use") {
						const toolResults = await collectToolResults({
							content,
							executeTool,
							ctx: { environment, correctionFilename: filename, corrections: creations, signal: controller.signal },
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

			// The entry may have been validated/dismissed and re-created while
			// this run was in flight — only save onto the exact entry this run
			// started from (same guard as correctionRun).
			if (creations.get(filename) === entry) {
				creations.setChatMessages(filename, history);
			}
			registry.finishRun(run, pushEvent, { runId, status: stopped ? "stopped" : "done" });
		})().catch((err) => {
			registry.finishRun(run, pushEvent, { runId, status: "error", error: err.message });
		});

		return runId;
	}

	return { startCreationChatRun };
};
