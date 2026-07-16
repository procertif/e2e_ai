const path = require("path");
const { readJson, writeJson } = require("../../core/jsonFiles");
const {
	DEFAULT_CLASSIC_INSTRUCTIONS,
	DEFAULT_CORRECTION_INSTRUCTIONS,
	classicSystemBlocks,
	correctionSystemBlocks,
} = require("../../ai/prompts");

// User-editable system prompts (Configuration page). Overrides live in
// data/config/prompts.json — outside data/versioned/ on purpose: prompt
// tweaks are local operator preferences, not test assets to sync/push.
// A null/absent override means "use the built-in default from ai/prompts.js".
module.exports = function createPromptsConfig({ CONFIG_DIR }) {
	const FILE = path.join(CONFIG_DIR, "prompts.json");

	function readOverrides() {
		const data = readJson(FILE);
		return {
			classic: typeof data?.classic === "string" && data.classic.trim() ? data.classic : null,
			correction: typeof data?.correction === "string" && data.correction.trim() ? data.correction : null,
		};
	}

	function getAll() {
		const overrides = readOverrides();
		return {
			classic: { value: overrides.classic, default: DEFAULT_CLASSIC_INSTRUCTIONS },
			correction: { value: overrides.correction, default: DEFAULT_CORRECTION_INSTRUCTIONS },
		};
	}

	// Saving text identical to the default (or blank) stores null, so the
	// prompt keeps tracking future default improvements instead of freezing
	// today's wording as a stale override.
	function set({ classic, correction }) {
		const normalize = (value, def) => {
			if (typeof value !== "string") return null;
			const trimmed = value.trim();
			return trimmed && trimmed !== def.trim() ? value : null;
		};
		const overrides = {
			classic: normalize(classic, DEFAULT_CLASSIC_INSTRUCTIONS),
			correction: normalize(correction, DEFAULT_CORRECTION_INSTRUCTIONS),
		};
		writeJson(FILE, overrides);
		return getAll();
	}

	return {
		getAll,
		set,
		classicBlocks: () => classicSystemBlocks(readOverrides().classic),
		correctionBlocks: (filename) => correctionSystemBlocks(filename, readOverrides().correction),
	};
};
