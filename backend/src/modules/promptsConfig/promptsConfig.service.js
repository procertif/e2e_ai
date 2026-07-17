const path = require("path");
const { readJson, writeJson } = require("../../core/jsonFiles");
const {
	DEFAULT_CLASSIC_INSTRUCTIONS,
	DEFAULT_CORRECTION_INSTRUCTIONS,
	DEFAULT_CREATION_INSTRUCTIONS,
	DEFAULT_SCENARIO_INSTRUCTIONS,
	classicSystemBlocks,
	correctionSystemBlocks,
	creationSystemBlocks,
	scenarioSystemBlocks,
} = require("../../ai/prompts");

const DEFAULTS = {
	classic: DEFAULT_CLASSIC_INSTRUCTIONS,
	correction: DEFAULT_CORRECTION_INSTRUCTIONS,
	creation: DEFAULT_CREATION_INSTRUCTIONS,
	scenario: DEFAULT_SCENARIO_INSTRUCTIONS,
};
const KEYS = Object.keys(DEFAULTS);

// User-editable system prompts (Configuration page). Overrides live in
// data/config/prompts.json — outside data/versioned/ on purpose: prompt
// tweaks are local operator preferences, not test assets to sync/push.
// A null/absent override means "use the built-in default from ai/prompts.js".
module.exports = function createPromptsConfig({ CONFIG_DIR }) {
	const FILE = path.join(CONFIG_DIR, "prompts.json");

	function readOverrides() {
		const data = readJson(FILE);
		const overrides = {};
		for (const key of KEYS) {
			overrides[key] = typeof data?.[key] === "string" && data[key].trim() ? data[key] : null;
		}
		return overrides;
	}

	function getAll() {
		const overrides = readOverrides();
		const all = {};
		for (const key of KEYS) all[key] = { value: overrides[key], default: DEFAULTS[key] };
		return all;
	}

	// Saving text identical to the default (or blank) stores null, so the
	// prompt keeps tracking future default improvements instead of freezing
	// today's wording as a stale override.
	function set(values) {
		const overrides = {};
		for (const key of KEYS) {
			const value = values?.[key];
			overrides[key] =
				typeof value === "string" && value.trim() && value.trim() !== DEFAULTS[key].trim() ? value : null;
		}
		writeJson(FILE, overrides);
		return getAll();
	}

	return {
		KEYS,
		getAll,
		set,
		classicBlocks: () => classicSystemBlocks(readOverrides().classic),
		correctionBlocks: (filename) => correctionSystemBlocks(filename, readOverrides().correction),
		creationBlocks: (filename) => creationSystemBlocks(filename, readOverrides().creation),
		scenarioBlocks: (scenarioName) => scenarioSystemBlocks(scenarioName, readOverrides().scenario),
	};
};
