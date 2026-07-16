const fs = require("fs");
const path = require("path");
const { readJson, writeJson, listJsonFiles } = require("../../core/jsonFiles");

// One JSON file per group under data/versioned/groups/ — lives next to the
// tests it references and can be inspected/diffed directly on disk.
module.exports = function createGroupsRepository({ GROUPS_DIR }) {
	fs.mkdirSync(GROUPS_DIR, { recursive: true });

	function fileFor(id) {
		return path.join(GROUPS_DIR, `${id}.json`);
	}

	function list() {
		return listJsonFiles(GROUPS_DIR)
			.map((f) => readJson(path.join(GROUPS_DIR, f)))
			.filter(Boolean)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	function save(group) {
		const now = Date.now();
		const existing = readJson(fileFor(group.id));
		const record = {
			id: group.id,
			name: group.name,
			tests: group.tests,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		writeJson(fileFor(group.id), record);
		return record;
	}

	function remove(id) {
		try {
			fs.unlinkSync(fileFor(id));
		} catch {}
	}

	return { list, save, remove };
};
