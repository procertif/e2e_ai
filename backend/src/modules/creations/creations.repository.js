const fs = require("fs");
const path = require("path");
const { isSafeTestFilename, isSafeTestname } = require("../../core/safeNames");

// Tests being authored from scratch on the Tests page ("Création de test").
// Same shape and lifecycle as the corrections repository — one draft entry
// per test filename, persisted as one JSON file per test under
// data/creations/ (NOT under data/versioned/: a test mid-creation isn't
// ready to be pushed to the backup repo). The real spec file in TESTS_DIR
// only appears on validate(). Keyed by filename (with .spec.ts) on purpose:
// the AI tools' draft branch (ctx.correctionFilename + a repo exposing
// get/updateDraft/setLastRunStatus) works for either repository, so creation
// runs reuse WriteTestFile/RunTest unchanged.
module.exports = function createCreationsRepository({ TESTS_DIR, CREATIONS_DIR, testMeta }) {
	const pending = new Map();

	function recordPath(filename) {
		return path.join(CREATIONS_DIR, filename.replace(/\.spec\.ts$/, "") + ".json");
	}

	function persist(entry) {
		fs.mkdirSync(CREATIONS_DIR, { recursive: true });
		fs.writeFileSync(recordPath(entry.filename), JSON.stringify(entry, null, 2));
	}

	function unpersist(filename) {
		try {
			fs.unlinkSync(recordPath(filename));
		} catch {}
	}

	// Rehydrate whatever was mid-creation when the server last stopped.
	if (fs.existsSync(CREATIONS_DIR)) {
		for (const f of fs.readdirSync(CREATIONS_DIR).filter((f) => f.endsWith(".json"))) {
			try {
				const entry = JSON.parse(fs.readFileSync(path.join(CREATIONS_DIR, f), "utf-8"));
				if (entry?.filename) pending.set(entry.filename, entry);
			} catch {}
		}
	}

	function summarize(entry) {
		return {
			filename: entry.filename,
			title: entry.title || null,
			createdAt: entry.createdAt,
			environmentId: entry.environmentId ?? null,
			aiEdited: entry.aiEdited,
			userEdited: entry.userEdited,
			hasDraft: Boolean((entry.draftContent || "").trim()),
			lastRunStatus: entry.lastRunStatus,
			// Entries from before this flag existed were created under the
			// scenario-mandatory regime — treat them as already validated.
			scenarioValidated: entry.scenarioValidated !== false,
		};
	}

	function list() {
		return [...pending.values()].sort((a, b) => b.createdAt - a.createdAt).map(summarize);
	}

	function get(filename) {
		return pending.get(filename) || null;
	}

	// Same title→testname derivation as scenario creation, so a test and its
	// scenario created from the same title share one name.
	function slugFromTitle(title) {
		return String(title || "")
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
	}

	// A creation is anchored to a scenario sharing its testname — either an
	// existing one picked in the modal (scenarioValidated starts true, the
	// AI can build the test right away), or none (the testname derives from
	// the title, and the entry starts in the "write the scenario first"
	// state until the user validates it). The scenario record itself is the
	// controller's business; name/collision rules live here.
	function create(title, scenarioTestname, environmentId) {
		const cleanTitle = String(title || "").trim();
		if (!cleanTitle || cleanTitle.length > 120) throw new Error("Title required (max 120 chars).");
		const fromScenario = Boolean(String(scenarioTestname || "").trim());
		const testname = fromScenario ? String(scenarioTestname).trim() : slugFromTitle(cleanTitle);
		if (!testname || !isSafeTestname(testname) || !/^[a-z0-9][a-z0-9_]*$/.test(testname)) {
			throw new Error(fromScenario ? "Invalid scenario name." : "Title must contain at least one letter or digit.");
		}
		const filename = testname + ".spec.ts";
		if (pending.has(filename)) throw new Error("A test is already being created for this scenario.");
		if (fs.existsSync(path.join(TESTS_DIR, filename))) throw new Error("This scenario already has a test.");
		const entry = {
			filename,
			title: cleanTitle,
			createdAt: Date.now(),
			environmentId: environmentId ?? null,
			consoleOutput: "",
			draftContent: "",
			chatMessages: [],
			aiEdited: false,
			userEdited: false,
			lastRunStatus: null,
			lastRunWasEdited: false,
			scenarioValidated: fromScenario,
		};
		pending.set(filename, entry);
		persist(entry);
		return entry;
	}

	// State switch for the creation flow: false = the right panel shows the
	// scenario editor (spec + scenario assistant), true = the test-building
	// panel (IA/editor/console…). "Éditer le scénario" flips it back.
	function setScenarioValidated(filename, validated) {
		const entry = pending.get(filename);
		if (!entry) throw new Error("Test not in creation.");
		entry.scenarioValidated = Boolean(validated);
		persist(entry);
		return entry;
	}

	// Same contract as corrections.updateDraft — see the comments there. The
	// AI tools call this blindly through ctx.corrections.
	function updateDraft(filename, content, source) {
		const entry = pending.get(filename);
		if (!entry) return null;
		if (entry.draftContent !== content) {
			entry.lastRunStatus = null;
			entry.lastRunWasEdited = false;
			if (source === "user" && (entry.chatMessages || []).length > 0) entry.contextStale = true;
			if (source === "ai") entry.aiEdited = true;
			if (source === "user") entry.userEdited = true;
		}
		entry.draftContent = content;
		persist(entry);
		return entry;
	}

	function setLastRunStatus(filename, status, consoleOutput) {
		const entry = pending.get(filename);
		if (!entry) return;
		entry.lastRunStatus = status;
		entry.lastRunWasEdited = (entry.draftContent || "").trim().length > 0;
		if (typeof consoleOutput === "string") entry.consoleOutput = consoleOutput;
		persist(entry);
	}

	function getChatMessages(filename) {
		return pending.get(filename)?.chatMessages || [];
	}

	function setChatMessages(filename, messages) {
		const entry = pending.get(filename);
		if (!entry) return;
		entry.chatMessages = messages;
		persist(entry);
	}

	function clearContextStale(filename) {
		const entry = pending.get(filename);
		if (!entry || !entry.contextStale) return;
		entry.contextStale = false;
		persist(entry);
	}

	// Promotes the draft into a real spec file in TESTS_DIR (which also
	// triggers the fs.watch-based Gherkin spec generation, like any new test)
	// and drops the entry.
	function validate(filename) {
		if (!isSafeTestFilename(filename)) throw new Error("Invalid filename.");
		const entry = pending.get(filename);
		if (!entry) throw new Error("Test not in creation.");
		if (!(entry.draftContent || "").trim()) throw new Error("Draft is empty — nothing to validate.");
		// Only a draft whose CURRENT content has a passing run can be
		// promoted (updateDraft resets lastRunStatus on any later edit, so a
		// stale verdict can't sneak an unproven draft through).
		if (entry.lastRunStatus !== "passed") throw new Error("The test must pass before it can be validated.");
		fs.mkdirSync(TESTS_DIR, { recursive: true });
		const confirmedPath = path.join(TESTS_DIR, filename);
		fs.writeFileSync(confirmedPath, entry.draftContent);
		try { fs.chmodSync(confirmedPath, 0o640); } catch {} // restore group-read for e2erunner (umask 077 strips it)
		testMeta?.markCreated(filename.replace(/\.spec\.ts$/, ""));
		pending.delete(filename);
		unpersist(filename);
		return { filename };
	}

	function remove(filename) {
		const existed = pending.delete(filename);
		if (existed) unpersist(filename);
		return existed;
	}

	return { list, get, create, setScenarioValidated, updateDraft, validate, remove, getChatMessages, setChatMessages, clearContextStale, setLastRunStatus, isSafeTestFilename };
};
