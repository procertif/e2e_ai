const fs = require("fs");
const path = require("path");
const { readJson, writeJson, listJsonFiles } = require("../../core/jsonFiles");

// One JSON file per environment under data/environments/ — deliberately
// outside data/versioned/ because environments hold plaintext variable
// values (OTP codes, tokens…) that must never reach the backup repo.
module.exports = function createEnvironmentsRepository({ ENVIRONMENTS_DIR }) {
	fs.mkdirSync(ENVIRONMENTS_DIR, { recursive: true });

	function fileFor(id) {
		return path.join(ENVIRONMENTS_DIR, `${id}.json`);
	}

	function list() {
		return listJsonFiles(ENVIRONMENTS_DIR)
			.map((f) => readJson(path.join(ENVIRONMENTS_DIR, f)))
			.filter(Boolean)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	function get(id) {
		return readJson(fileFor(id));
	}

	function create({ name, url, variables, color, branch }) {
		const existingIds = listJsonFiles(ENVIRONMENTS_DIR)
			.map((f) => parseInt(f, 10))
			.filter(Number.isInteger);
		const id = existingIds.length ? Math.max(...existingIds) + 1 : 1;
		const now = Date.now();
		const environment = {
			id,
			name,
			url,
			variables: variables || [],
			color,
			branch: branch || null,
			createdAt: now,
			updatedAt: now,
		};
		writeJson(fileFor(id), environment);
		return environment;
	}

	function update(id, data) {
		const environment = get(id);
		if (!environment) return null;
		Object.assign(environment, data, { updatedAt: Date.now() });
		writeJson(fileFor(id), environment);
		return environment;
	}

	function remove(id) {
		try {
			fs.unlinkSync(fileFor(id));
		} catch {}
	}

	return { list, get, create, update, remove };
};
