const fs = require("fs");
const path = require("path");

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
}

function writeJson(file, data) {
	// A versioned-repo sync/push (git merge) can delete an entire category
	// folder at runtime — e.g. removing the last campaign leaves no tracked
	// file, and git doesn't keep empty directories. Startup mkdirs only run
	// once, so re-create the folder on every write instead of assuming it
	// still exists.
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function listJsonFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
}

module.exports = { readJson, writeJson, listJsonFiles };
