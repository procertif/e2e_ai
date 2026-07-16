const fs = require("fs");
const path = require("path");
const { isSafeTestname } = require("../../core/safeNames");

module.exports = function createWriteTestFile({ TESTS_DIR, PENDING_DIR }) {
	return function writeTestFile(input, ctx) {
		if (input.mode !== "create" && input.mode !== "edit") return 'Error: mode must be "create" or "edit".';

		// Correction mode: the tool always targets the correction's in-memory
		// draft, never the filesystem — the human validates the draft into the
		// real spec file separately.
		if (ctx?.correctionFilename) {
			const filename = ctx.correctionFilename;
			const entry = ctx.corrections.get(filename);
			if (!entry) return "Error: this test is no longer in correction.";
			if (input.mode === "create") {
				if (typeof input.content !== "string") return 'Error: content is required for mode "create".';
				ctx.corrections.updateDraft(filename, input.content, "ai");
			} else {
				if (typeof input.old_string !== "string" || typeof input.new_string !== "string") {
					return 'Error: old_string and new_string are required for mode "edit".';
				}
				if (!entry.draftContent.includes(input.old_string)) return "Error: old_string not found in the current draft.";
				const content = input.replace_all
					? entry.draftContent.split(input.old_string).join(input.new_string)
					: entry.draftContent.replace(input.old_string, input.new_string);
				ctx.corrections.updateDraft(filename, content, "ai");
			}
			return `Brouillon mis à jour (${filename}).`;
		}

		if (!isSafeTestname(input.testname)) return "Error: invalid testname.";
		const testname = input.testname;

		if (input.kind === "spec") {
			const pendingPath = path.join(PENDING_DIR, testname + ".spec.ts");
			if (input.mode === "create") {
				if (typeof input.content !== "string") return 'Error: content is required for mode "create".';
				fs.mkdirSync(PENDING_DIR, { recursive: true });
				fs.writeFileSync(pendingPath, input.content);
			} else {
				if (typeof input.old_string !== "string" || typeof input.new_string !== "string") {
					return 'Error: old_string and new_string are required for mode "edit".';
				}
				const livePath = path.join(TESTS_DIR, testname + ".spec.ts");
				const sourcePath = fs.existsSync(pendingPath) ? pendingPath : livePath;
				if (!fs.existsSync(sourcePath)) return 'Error: no existing spec to edit — use mode "create" first.';
				let content = fs.readFileSync(sourcePath, "utf-8");
				if (!content.includes(input.old_string)) return "Error: old_string not found in file.";
				content = input.replace_all
					? content.split(input.old_string).join(input.new_string)
					: content.replace(input.old_string, input.new_string);
				fs.mkdirSync(PENDING_DIR, { recursive: true });
				fs.writeFileSync(pendingPath, content);
			}
			return { _isPending: true, testname, message: `Modifications enregistrées en attente de confirmation (${testname}.spec.ts).` };
		}

		if (input.kind === "actions") {
			// Staged like the spec itself — written to data/pending/ and
			// registered as the test's scenario only once the human confirms the
			// matching pending spec (see the pending module's confirm). Otherwise
			// a discarded test would still leave scenario metadata behind.
			const pendingPath = path.join(PENDING_DIR, testname + ".actions.json");
			if (input.mode === "create") {
				if (typeof input.content !== "string") return 'Error: content is required for mode "create".';
				let parsed;
				try { parsed = JSON.parse(input.content); } catch { return "Error: content must be valid JSON."; }
				parsed.environmentId = ctx?.environment?.id ?? null;
				parsed.environmentName = ctx?.environment?.name ?? null;
				fs.mkdirSync(PENDING_DIR, { recursive: true });
				fs.writeFileSync(pendingPath, JSON.stringify(parsed, null, 2));
			} else {
				if (typeof input.old_string !== "string" || typeof input.new_string !== "string") {
					return 'Error: old_string and new_string are required for mode "edit".';
				}
				if (!fs.existsSync(pendingPath)) return 'Error: no existing actions file to edit — use mode "create" first.';
				let content = fs.readFileSync(pendingPath, "utf-8");
				if (!content.includes(input.old_string)) return "Error: old_string not found in file.";
				content = input.replace_all
					? content.split(input.old_string).join(input.new_string)
					: content.replace(input.old_string, input.new_string);
				fs.writeFileSync(pendingPath, content);
			}
			return `Actions enregistrées en attente (${testname}.json) — appliquées à la confirmation du test.`;
		}

		return 'Error: kind must be "spec" or "actions".';
	};
};
