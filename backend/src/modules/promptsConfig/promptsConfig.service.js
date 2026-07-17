const path = require("path");
const { readJson, writeJson } = require("../../core/jsonFiles");
const {
	DEFAULT_CORRECTION_INSTRUCTIONS,
	DEFAULT_CREATION_INSTRUCTIONS,
	DEFAULT_SCENARIO_INSTRUCTIONS,
	correctionSystemBlocks,
	creationSystemBlocks,
	scenarioSystemBlocks,
} = require("../../ai/prompts");

const DEFAULTS = {
	correction: DEFAULT_CORRECTION_INSTRUCTIONS,
	creation: DEFAULT_CREATION_INSTRUCTIONS,
	scenario: DEFAULT_SCENARIO_INSTRUCTIONS,
};
const KEYS = Object.keys(DEFAULTS);

// User additions to the system prompts (Configuration page). The built-in
// prompts from ai/prompts.js are MANDATORY — what's stored here (one string
// per key in data/config/prompts.json, outside data/versioned/ on purpose)
// is only a custom block APPENDED at the end of the base prompt. null/absent
// means "base prompt as-is".
module.exports = function createPromptsConfig({ CONFIG_DIR }) {
	const FILE = path.join(CONFIG_DIR, "prompts.json");

	function readCustoms() {
		const data = readJson(FILE);
		const customs = {};
		for (const key of KEYS) {
			customs[key] = typeof data?.[key] === "string" && data[key].trim() ? data[key] : null;
		}
		return customs;
	}

	// value = the custom addition (empty when none); default = the mandatory
	// base prompt, exposed read-only by the Configuration page.
	function getAll() {
		const customs = readCustoms();
		const all = {};
		for (const key of KEYS) all[key] = { value: customs[key], default: DEFAULTS[key] };
		return all;
	}

	function set(values) {
		const customs = {};
		for (const key of KEYS) {
			const value = values?.[key];
			customs[key] = typeof value === "string" && value.trim() ? value : null;
		}
		writeJson(FILE, customs);
		return getAll();
	}

	// Full instructions handed to the prompt templates: base + custom block,
	// or null (→ the template uses its default) when nothing was added.
	function combined(key) {
		const custom = readCustoms()[key];
		return custom ? `${DEFAULTS[key]}\n\n${custom}` : null;
	}

	return {
		KEYS,
		getAll,
		set,
		correctionBlocks: (filename) => correctionSystemBlocks(filename, combined("correction")),
		creationBlocks: (filename) => creationSystemBlocks(filename, combined("creation")),
		scenarioBlocks: (scenarioName) => scenarioSystemBlocks(scenarioName, combined("scenario")),
	};
};
