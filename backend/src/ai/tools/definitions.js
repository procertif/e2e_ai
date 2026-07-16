// Tool schemas sent to the Anthropic API — execution lives in the sibling
// files, dispatched by tools/index.js. CLASSIC_TOOLS is the default set
// (classic chat + corrections); SCENARIO_TOOLS is the restricted set for
// scenario conversations (read the tested app's source, write the scenario's
// expected-result spec — no test files, no test runs).
const CLASSIC_TOOLS = [
	{
		name: "WriteTestFile",
		description:
			"Create or edit a test spec (data/versioned/tests/<testname>.spec.ts) or its matching action list (data/actionTest/<testname>.json). Both are staged for human review — applied together only once the human confirms, never directly. No other path is reachable through this tool.",
		input_schema: {
			type: "object",
			properties: {
				kind: { type: "string", enum: ["spec", "actions"], description: "\"spec\" for the .spec.ts test, \"actions\" for the actionTest .json" },
				testname: { type: "string", description: "Test name only, no extension and no path, e.g. \"creation_question_qcm\"" },
				mode: { type: "string", enum: ["create", "edit"], description: "\"create\" writes full content (creates or overwrites); \"edit\" replaces old_string with new_string in the existing file" },
				content: { type: "string", description: "Full file content — required when mode is \"create\"" },
				old_string: { type: "string", description: "Exact text to replace — required when mode is \"edit\"" },
				new_string: { type: "string", description: "Replacement text — required when mode is \"edit\"" },
				replace_all: { type: "boolean", description: "Replace every occurrence of old_string instead of just the first one (edit mode only)" },
			},
			required: ["kind", "testname", "mode"],
		},
	},
	{
		name: "ReadDataFile",
		description:
			"Read-only access to data/ (tests, actionTest, screenshots, versioned scenarios/environments…) and to src/testUtils.ts. Directories return a listing, .png files return the image, everything else returns text. No other path is reachable.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path relative to the project root, e.g. \"data/screenshots/creation_question_qcm\" or \"src/testUtils.ts\"" },
			},
			required: ["path"],
		},
		cache_control: { type: "ephemeral", ttl: "1h" },
	},
	{
		name: "ListEnvironmentVariables",
		description:
			"List the environment variables available via getEnvironmentVariable(key) from testUtils.ts, for the environment currently targeted in this conversation. Keys and descriptions only — values are never exposed to you.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	{
		name: "RunTest",
		description:
			"Run a Playwright test spec against the environment currently targeted in this conversation and return its console output (pass/fail, errors). The spec must already exist (write it with WriteTestFile first).",
		input_schema: {
			type: "object",
			properties: {
				testname: { type: "string", description: "Test name only, no extension and no path, e.g. \"creation_question_qcm\"" },
				pending: { type: "boolean", description: "true to run the staged not-yet-confirmed version (data/pending/) instead of the live one (data/versioned/tests/)" },
			},
			required: ["testname"],
		},
	},
	{
		name: "WebFetch",
		description: "Fetch the content of a URL and return it as plain text (HTML tags stripped).",
		input_schema: {
			type: "object",
			properties: {
				url: { type: "string", description: "The URL to fetch" },
				max_length: { type: "number", description: "Max characters to return (default 20000)" },
			},
			required: ["url"],
		},
	},
	{
		name: "FindSelector",
		description:
			"Search the tested application's real source code, checked out at data/testedRepositories/<branch>/ (<branch> = the repository branch linked to the conversation's target environment) — read-only, a few lines of context per match, never full files. Use it to find a piece of UI (button/label text, route, field name, component) and get the exact selector for a Playwright test. Only available if that environment has a branch fetched (see the Environments page); use ReadDataFile on the same data/testedRepositories/<branch>/... path to read a full file once you know where to look.",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Exact text to search for, e.g. \"Créer un badge\" or \"certifications/add\"" },
			},
			required: ["query"],
		},
	},
];

const WRITE_SCENARIO_SPEC = {
	name: "WriteScenarioSpec",
	description:
		"Replace the expected-result specification of the scenario this conversation is scoped to. The content is a short French Gherkin document: every non-empty line starts with \"Étant donné\", \"Quand\", \"Alors\", \"Et\" or \"Mais\"; user point of view only (no selectors, no technical terms, no physical UI interactions); 5 to 12 lines. This is the only way the scenario shown in the app gets updated.",
	input_schema: {
		type: "object",
		properties: {
			content: { type: "string", description: "The full new specification (replaces the previous one entirely)" },
		},
		required: ["content"],
	},
};

const byName = (name) => CLASSIC_TOOLS.find((t) => t.name === name);
const SCENARIO_TOOLS = [WRITE_SCENARIO_SPEC, byName("ReadDataFile"), byName("FindSelector"), byName("WebFetch")];

module.exports = CLASSIC_TOOLS;
module.exports.CLASSIC_TOOLS = CLASSIC_TOOLS;
module.exports.SCENARIO_TOOLS = SCENARIO_TOOLS;
