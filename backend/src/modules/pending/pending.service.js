const fs = require("fs");
const path = require("path");

// Specs written by the AI land in data/pending/ first, awaiting a human
// decision: confirm (promote to TESTS_DIR + register the scenario), discard,
// or run (preview execution without confirming).
module.exports = function createPendingService({ paths, scenariosRepo, testMeta }) {
	const { PENDING_DIR, TESTS_DIR, ACTION_TESTS_DIR } = paths;

	function specPath(testname) {
		return path.join(PENDING_DIR, testname + ".spec.ts");
	}

	function actionsPath(testname) {
		return path.join(PENDING_DIR, testname + ".actions.json");
	}

	function list() {
		fs.mkdirSync(PENDING_DIR, { recursive: true });
		return fs.readdirSync(PENDING_DIR)
			.filter((f) => f.endsWith(".spec.ts"))
			.map((f) => f.replace(".spec.ts", ""));
	}

	function exists(testname) {
		return fs.existsSync(specPath(testname));
	}

	// The AI stages its action list alongside the spec while iterating; it
	// only gets registered as the test's scenario here, on confirm —
	// otherwise a discarded test would still leave scenario metadata behind.
	// Registered before copying the spec into TESTS_DIR so the fs.watch-
	// triggered spec.md generation always finds it.
	function confirm(testname) {
		const pendingActionsFile = actionsPath(testname);
		if (fs.existsSync(pendingActionsFile)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(pendingActionsFile, "utf-8"));
				scenariosRepo.upsert(testname, {
					file: parsed.file || "",
					description: parsed.description || "",
					actions: parsed.actions || [],
					environmentId: parsed.environmentId ?? null,
					environmentName: parsed.environmentName ?? null,
				});
				fs.mkdirSync(ACTION_TESTS_DIR, { recursive: true });
				fs.writeFileSync(path.join(ACTION_TESTS_DIR, testname + ".json"), JSON.stringify(parsed, null, 2));
			} catch {}
			fs.unlinkSync(pendingActionsFile);
		}
		fs.mkdirSync(TESTS_DIR, { recursive: true });
		const confirmedPath = path.join(TESTS_DIR, testname + ".spec.ts");
		fs.copyFileSync(specPath(testname), confirmedPath);
		try { fs.chmodSync(confirmedPath, 0o640); } catch {} // restore group-read for e2erunner (umask 077 strips it)
		fs.unlinkSync(specPath(testname));
		testMeta.markCreated(testname);
	}

	function discard(testname) {
		fs.unlinkSync(specPath(testname));
		try { fs.unlinkSync(actionsPath(testname)); } catch {}
	}

	return { list, exists, confirm, discard };
};
