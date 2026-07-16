const MAX_TOOL_OUTPUT = 10000; // caractères — ajustable selon le budget token

function truncate(str) {
	if (str.length <= MAX_TOOL_OUTPUT) return str;
	return str.slice(0, MAX_TOOL_OUTPUT) + `\n...[tronqué : ${str.length - MAX_TOOL_OUTPUT} caractères supplémentaires]`;
}

// Builds the executeTool(name, input, ctx) dispatcher. ctx carries the
// per-run context: { environment, signal, onToolOutput } for classic chat,
// plus { correctionFilename, corrections } when the run is scoped to a
// correction draft.
function createToolExecutor({ paths, testRunner, testedRepo }) {
	const shared = {
		E2E_DIR: paths.E2E_DIR,
		DATA_DIR: paths.DATA_DIR,
		TESTS_DIR: paths.TESTS_DIR,
		PENDING_DIR: paths.PENDING_DIR,
		TEST_UTILS_PATH: paths.TEST_UTILS_PATH,
		testRunner,
		testedRepo,
		truncate,
		MAX_TOOL_OUTPUT,
	};
	const handlers = {
		WriteTestFile: require("./writeTestFile")(shared),
		ReadDataFile: require("./readDataFile")(shared),
		ListEnvironmentVariables: require("./listEnvironmentVariables")(shared),
		RunTest: require("./runTest")(shared),
		WebFetch: require("./webFetch")(shared),
		FindSelector: require("./findSelector")(shared),
		WriteScenarioSpec: require("./writeScenarioSpec")(shared),
	};

	return async function executeTool(name, input, ctx) {
		const handler = handlers[name];
		if (!handler) return `Unknown tool: ${name}`;
		try {
			return await handler(input, ctx);
		} catch (e) {
			return "Error: " + e.message;
		}
	};
}

module.exports = { createToolExecutor };
