const fs = require("fs");
const path = require("path");
const { readJson, writeJson, listJsonFiles } = require("../../core/jsonFiles");

// One JSON file per scenario (a test's action list + generated Gherkin spec
// + target environment) under data/versioned/scenarios/, keyed by testname.
module.exports = function createScenariosRepository({ SCENARIOS_DIR }) {
	fs.mkdirSync(SCENARIOS_DIR, { recursive: true });

	function fileFor(testname) {
		return path.join(SCENARIOS_DIR, `${testname}.json`);
	}

	function get(testname) {
		return readJson(fileFor(testname));
	}

	function upsert(testname, data) {
		const existing = get(testname) || {};
		const record = { ...existing, ...data, testname, updatedAt: Date.now() };
		writeJson(fileFor(testname), record);
		return record;
	}

	function remove(testname) {
		try {
			fs.unlinkSync(fileFor(testname));
		} catch {}
	}

	function list() {
		return listJsonFiles(SCENARIOS_DIR)
			.map((f) => readJson(path.join(SCENARIOS_DIR, f)))
			.filter(Boolean);
	}

	return { get, upsert, remove, list };
};
