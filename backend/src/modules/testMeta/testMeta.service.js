const fs = require("fs");
const path = require("path");

// Per-test lifecycle metadata shown on the "Liste des tests" tab — one JSON
// file per testname under data/testMeta/ (runtime stats, deliberately not in
// data/versioned/). The rest of the app feeds it through the hooks below:
// - markCreated: a test file is born (creation validated, pending confirmed)
// - markUpdated: its content is rewritten (correction validated)
// - recordRun: a real run of the confirmed test finished (Tests page queue /
//   campaigns) — remembers the target environment, and the duration when it
//   passed
// - ensure: lazy backfill for tests that predate this store (createdAt/
//   updatedAt default to "now", the run fields stay empty until a real run)
module.exports = function createTestMetaService({ TEST_META_DIR }) {
	function fileFor(testname) {
		return path.join(TEST_META_DIR, testname + ".json");
	}

	function read(testname) {
		try {
			return JSON.parse(fs.readFileSync(fileFor(testname), "utf-8"));
		} catch {
			return null;
		}
	}

	function write(meta) {
		fs.mkdirSync(TEST_META_DIR, { recursive: true });
		fs.writeFileSync(fileFor(meta.testname), JSON.stringify(meta, null, 2));
	}

	function get(testname) {
		return read(testname);
	}

	function ensure(testname) {
		const existing = read(testname);
		if (existing) return existing;
		const meta = {
			testname,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastSuccessMs: null,
			lastSuccessAt: null,
			lastEnvironmentId: null,
			lastEnvironmentName: null,
		};
		write(meta);
		return meta;
	}

	function markCreated(testname) {
		const meta = ensure(testname);
		meta.createdAt = Date.now();
		meta.updatedAt = Date.now();
		write(meta);
		return meta;
	}

	function markUpdated(testname) {
		const meta = ensure(testname);
		meta.updatedAt = Date.now();
		write(meta);
		return meta;
	}

	function recordRun(testname, { success, durationMs, environmentId = null, environmentName = null } = {}) {
		const meta = ensure(testname);
		if (environmentId != null) {
			meta.lastEnvironmentId = environmentId;
			meta.lastEnvironmentName = environmentName;
		}
		if (success && Number.isFinite(durationMs)) {
			meta.lastSuccessMs = Math.round(durationMs);
			meta.lastSuccessAt = Date.now();
		}
		write(meta);
		return meta;
	}

	function remove(testname) {
		try {
			fs.unlinkSync(fileFor(testname));
		} catch {}
	}

	return { get, ensure, markCreated, markUpdated, recordRun, remove };
};
