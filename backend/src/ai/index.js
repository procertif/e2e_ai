const createAnthropicClient = require("./client");
const { createToolExecutor } = require("./tools");
const { createRunRegistry } = require("./runRegistry");
const createConversationRun = require("./conversationRun");
const createCorrectionRun = require("./correctionRun");
const createScenarioRun = require("./scenarioRun");
const createSpecGenerator = require("./specGenerator");

// Wires the whole AI feature together. The returned surface is what the
// rest of the app (aiQueue, chat module, pending module) consumes — and what
// tests replace with a fake.
module.exports = function createAI({ paths, envLocal, testRunner, db, environments, scenarios, corrections, testedRepo, promptsConfig }) {
	const client = createAnthropicClient({ envLocal, promptsConfig });
	const executeTool = createToolExecutor({ paths, testRunner, testedRepo });
	const registry = createRunRegistry();

	const { startChatRun } = createConversationRun({ db, client, executeTool, registry, environments });
	const { startCorrectionChatRun } = createCorrectionRun({ client, executeTool, registry, environments, corrections, promptsConfig, scenarios });
	const { startScenarioChatRun } = createScenarioRun({ client, executeTool, registry, environments, scenarios, promptsConfig });
	const { generateSpec, generateMissingSpecs } = createSpecGenerator({ TESTS_DIR: paths.TESTS_DIR, client, scenarios });

	return {
		startChatRun,
		startCorrectionChatRun,
		startScenarioChatRun,
		generateSpec,
		generateMissingSpecs,
		getChatRun: registry.get,
	};
};
