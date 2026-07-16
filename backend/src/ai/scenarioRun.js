const { sanitizeToolUseHistory } = require("./history");
const { scenarioSystemBlocks } = require("./prompts");
const { SCENARIO_TOOLS } = require("./tools/definitions");
const { collectToolResults } = require("./toolLoop");

// Chat run scoped to one scenario's expected-result specification. Sibling
// of correctionRun, but with the restricted SCENARIO_TOOLS set: the model
// can read the tested app's source (FindSelector/ReadDataFile) and rewrite
// the scenario's spec (WriteScenarioSpec) — no test files, no test runs.
// History persists on the scenario entry itself (data/versioned/scenarios/).
module.exports = function createScenarioRun({ client, executeTool, registry, environments, scenarios, promptsConfig }) {
	function startScenarioChatRun(scenarioName, message, images, environmentId) {
		const entry = scenarios.get(scenarioName);
		if (!entry) throw new Error("Unknown scenario.");

		const { runId, run, pushEvent } = registry.createRun();

		const environment = environmentId != null ? environments.get(environmentId) : null;
		const systemBlocks = promptsConfig ? promptsConfig.scenarioBlocks(scenarioName) : scenarioSystemBlocks(scenarioName);

		(async () => {
			const history = entry.chatMessages || [];
			sanitizeToolUseHistory(history);
			const isFirstTurn = history.length === 0;
			const userText = isFirstTurn
				? `[Contexte automatique] Scénario : ${scenarioName}.\n\nRésultat attendu actuel :\n\`\`\`\n${entry.spec || "(vide — scénario à créer)"}\n\`\`\`\n\n${message || "Aide-moi à rédiger ce scénario."}`
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
					const { stopReason, content } = await client.callClaudeStream(token, history, pushEvent, null, controller.signal, systemBlocks, SCENARIO_TOOLS);
					history.push({ role: "assistant", content });

					if (stopReason === "tool_use") {
						const toolResults = await collectToolResults({
							content,
							executeTool,
							ctx: { environment, scenarioName, scenarios, signal: controller.signal },
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

			scenarios.upsert(scenarioName, { chatMessages: history });
			registry.finishRun(run, pushEvent, { runId, status: stopped ? "stopped" : "done" });
		})().catch((err) => {
			registry.finishRun(run, pushEvent, { runId, status: "error", error: err.message });
		});

		return runId;
	}

	return { startScenarioChatRun };
};
