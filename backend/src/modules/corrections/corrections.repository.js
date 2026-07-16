const fs = require("fs");
const path = require("path");
const { isSafeTestFilename } = require("../../core/safeNames");

// One entry per test filename — no "correction" grouping object. Proposing a
// correction on a campaign just drops every one of its failed tests into
// this flat pending set (keyed by filename, so a test already in correction
// from another campaign keeps its draft as-is). Persisted as one JSON file
// per test under data/corrections/ — deliberately NOT under data/versioned/,
// since a draft mid-fix isn't ready to be pushed to the backup repo. The
// real spec file in TESTS_DIR is only touched on validate().
module.exports = function createCorrectionsRepository({ TESTS_DIR, CORRECTIONS_DIR }) {
	const pending = new Map();

	function recordPath(filename) {
		return path.join(CORRECTIONS_DIR, filename.replace(/\.spec\.ts$/, "") + ".json");
	}

	function persist(entry) {
		fs.mkdirSync(CORRECTIONS_DIR, { recursive: true });
		fs.writeFileSync(recordPath(entry.filename), JSON.stringify(entry, null, 2));
	}

	function unpersist(filename) {
		try {
			fs.unlinkSync(recordPath(filename));
		} catch {}
	}

	// Rehydrate whatever was mid-fix when the server last stopped.
	if (fs.existsSync(CORRECTIONS_DIR)) {
		for (const f of fs.readdirSync(CORRECTIONS_DIR).filter((f) => f.endsWith(".json"))) {
			try {
				const entry = JSON.parse(fs.readFileSync(path.join(CORRECTIONS_DIR, f), "utf-8"));
				if (entry?.filename) pending.set(entry.filename, entry);
			} catch {}
		}
	}

	function summarize(entry) {
		return {
			filename: entry.filename,
			campaignId: entry.campaignId,
			campaignTitle: entry.campaignTitle,
			createdAt: entry.createdAt,
			environmentId: entry.environmentId ?? null,
			aiEdited: entry.aiEdited,
			userEdited: entry.userEdited,
			lastRunStatus: entry.lastRunStatus,
			lastRunWasEdited: entry.lastRunWasEdited,
		};
	}

	function list() {
		return [...pending.values()].sort((a, b) => b.createdAt - a.createdAt).map(summarize);
	}

	function get(filename) {
		return pending.get(filename) || null;
	}

	// Puts every failed test of a campaign into correction. A test already
	// pending keeps its in-progress draft and chat — only its "flagged from"
	// campaign/environment/console-output info gets refreshed, since those
	// describe the latest failure, not the fix in progress.
	function createForCampaign(campaign) {
		const failed = campaign.tests.filter((t) => t.status === "failed");
		for (const t of failed) {
			const existing = pending.get(t.filename);
			if (existing) {
				existing.campaignId = campaign.id;
				existing.campaignTitle = campaign.title;
				existing.environmentId = campaign.environmentId;
				existing.environmentName = campaign.environmentName;
				existing.consoleOutput = t.output || "";
				// The chat (if any) was about the PREVIOUS failure — its turn-1
				// snapshot of code/console no longer describes this one. Flag it so
				// the next correction turn re-injects the current context instead
				// of letting the AI reason on the old failure.
				if ((existing.chatMessages || []).length > 0) existing.contextStale = true;
				persist(existing);
				continue;
			}
			let content = "";
			try {
				content = fs.readFileSync(path.join(TESTS_DIR, t.filename), "utf-8");
			} catch {}
			const entry = {
				filename: t.filename,
				campaignId: campaign.id,
				campaignTitle: campaign.title,
				environmentId: campaign.environmentId,
				environmentName: campaign.environmentName,
				consoleOutput: t.output || "",
				createdAt: Date.now(),
				originalContent: content,
				draftContent: content,
				chatMessages: [],
				aiEdited: false,
				userEdited: false,
				lastRunStatus: null,
				lastRunWasEdited: false,
			};
			pending.set(t.filename, entry);
			persist(entry);
		}
		return failed.map((t) => summarize(pending.get(t.filename)));
	}

	// source distinguishes who touched the draft — surfaced in the list as
	// "AI corrected" / "user corrected" indicators (either or both can end up
	// true on the same test).
	function updateDraft(filename, content, source) {
		const entry = pending.get(filename);
		if (!entry) return null;
		// A prior run's passed/failed verdict describes the content that was
		// actually run — once the draft changes again, that verdict no longer
		// applies to what's on screen. Left stale, "Correction validée par le
		// test" (and the checkbox it disables) would keep showing for a draft
		// that was edited after the passing run and may not even pass anymore.
		if (entry.draftContent !== content) {
			entry.lastRunStatus = null;
			entry.lastRunWasEdited = false;
			// An AI edit is already visible in the conversation (its own tool
			// call); a user edit happens outside it, so the AI's view of the
			// draft is now wrong — flag for re-injection on the next turn.
			if (source === "user" && (entry.chatMessages || []).length > 0) entry.contextStale = true;
			// Only a save that actually changes the draft counts as an edit —
			// the editor's debounced PUT can echo back unchanged content (e.g.
			// right after an AI edit synced into it), which must not flip the
			// "corrigé manuellement" indicator.
			if (source === "ai") entry.aiEdited = true;
			if (source === "user") entry.userEdited = true;
		}
		entry.draftContent = content;
		persist(entry);
		return entry;
	}

	// Whether the draft had actually diverged from the original failing
	// content when this run happened — otherwise "passed" would be
	// indistinguishable from "the original bug just reproduced". The run's
	// console output replaces the entry's, so the Console tab always shows
	// the latest execution rather than the campaign failure that opened it.
	function setLastRunStatus(filename, status, consoleOutput) {
		const entry = pending.get(filename);
		if (!entry) return;
		entry.lastRunStatus = status;
		entry.lastRunWasEdited = entry.draftContent !== entry.originalContent;
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

	// Writes the draft to the real spec file and drops it out of the pending
	// set — the only place this module touches TESTS_DIR.
	function validate(filename) {
		if (!isSafeTestFilename(filename)) throw new Error("Invalid filename.");
		const entry = pending.get(filename);
		if (!entry) throw new Error("Test not in correction.");
		fs.mkdirSync(TESTS_DIR, { recursive: true });
		fs.writeFileSync(path.join(TESTS_DIR, filename), entry.draftContent);
		pending.delete(filename);
		unpersist(filename);
		return { filename };
	}

	function remove(filename) {
		const existed = pending.delete(filename);
		if (existed) unpersist(filename);
		return existed;
	}

	return { list, get, createForCampaign, updateDraft, validate, remove, getChatMessages, setChatMessages, clearContextStale, setLastRunStatus, isSafeTestFilename };
};
