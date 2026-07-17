const fs = require("fs");
const path = require("path");

module.exports = function createTestsService({ db, paths, scenariosRepo, groupsService, testMeta }) {
	const { TESTS_DIR, SCREENSHOTS_DIR, PENDING_DIR } = paths;

	async function loadAliases() {
		const rows = await db.testAlias.findMany();
		return Object.fromEntries(rows.map((r) => [r.testkey, r.alias]));
	}

	async function saveAliases(data) {
		const keys = Object.keys(data);
		await db.testAlias.deleteMany({ where: { testkey: { notIn: keys.length ? keys : ["__none__"] } } });
		for (const k of keys) {
			await db.testAlias.upsert({ where: { testkey: k }, create: { testkey: k, alias: data[k] }, update: { alias: data[k] } });
		}
	}

	async function loadRunHistory() {
		const rows = await db.runHistory.findMany();
		return Object.fromEntries(rows.map((r) => [r.filename, JSON.parse(r.durationsJson)]));
	}

	// Keeps the last 5 successful durations per test — averaged by
	// estimatedMs to predict how long the next run will take.
	async function recordRunDuration(filename, durationMs) {
		const existing = await db.runHistory.findUnique({ where: { filename } });
		let durations = existing ? JSON.parse(existing.durationsJson) : [];
		durations.push(Math.round(durationMs));
		if (durations.length > 5) durations = durations.slice(-5);
		await db.runHistory.upsert({
			where: { filename },
			create: { filename, durationsJson: JSON.stringify(durations) },
			update: { durationsJson: JSON.stringify(durations) },
		});
	}

	function estimatedMs(history, filename) {
		const runs = history[filename];
		if (!runs?.length) return null;
		return Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
	}

	function loadTestEnvironments() {
		const rows = scenariosRepo.list();
		return Object.fromEntries(rows.map((r) => [r.testname, { environmentId: r.environmentId ?? null, environmentName: r.environmentName ?? null }]));
	}

	// Derives display metadata from the "casN-type[-ai|-noai]" filename
	// convention; anything else falls back to the raw testkey.
	function describeTest(testkey, { alias, env, history, filename }) {
		const base = {
			filename,
			alias,
			estimatedMs: estimatedMs(history, filename),
			environmentId: env.environmentId,
			environmentName: env.environmentName,
		};
		const m = testkey.match(/^(?:\d+-)?cas(\d+)-(.+?)(?:-(?:ai|noai))?$/);
		if (m) {
			const [, casNum, type] = m;
			const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
			return { ...base, cas: `cas${casNum}`, casNum: parseInt(casNum), type, typeLabel, name: `Cas ${casNum} - ${typeLabel}` };
		}
		return { ...base, cas: testkey, casNum: 0, type: testkey, typeLabel: testkey, name: testkey.replace(/-/g, " ") };
	}

	async function listTests() {
		if (!fs.existsSync(TESTS_DIR)) return [];
		const history = await loadRunHistory();
		const aliases = await loadAliases();
		const testEnvironments = loadTestEnvironments();
		return fs
			.readdirSync(TESTS_DIR)
			.filter((f) => f.endsWith(".spec.ts"))
			.map((filename) => {
				const testkey = filename.replace(".spec.ts", "");
				// ensure() lazily backfills tests that predate the metadata store
				// (createdAt/updatedAt initialized to "now", run fields empty).
				const meta = testMeta.ensure(testkey);
				return {
					...describeTest(testkey, {
						filename,
						alias: aliases[testkey] || null,
						env: testEnvironments[testkey] || { environmentId: null, environmentName: null },
						history,
					}),
					createdAt: meta.createdAt,
					updatedAt: meta.updatedAt,
					lastSuccessMs: meta.lastSuccessMs ?? null,
					lastSuccessAt: meta.lastSuccessAt ?? null,
					lastEnvironmentId: meta.lastEnvironmentId ?? null,
					lastEnvironmentName: meta.lastEnvironmentName ?? null,
				};
			})
			.sort((a, b) => a.filename.localeCompare(b.filename));
	}

	// Deletes the test and every trace of it: spec file, screenshots, pending
	// draft, scenario, prompt history, group memberships, run history, alias.
	async function deleteTest(testkey) {
		const filename = testkey + ".spec.ts";
		try { fs.unlinkSync(path.join(TESTS_DIR, filename)); } catch {}
		const screenshotFolder = path.join(SCREENSHOTS_DIR, testkey);
		if (fs.existsSync(screenshotFolder)) {
			fs.rmSync(screenshotFolder, { recursive: true, force: true });
		}
		try { fs.unlinkSync(path.join(PENDING_DIR, filename)); } catch {}
		scenariosRepo.remove(testkey);
		testMeta.remove(testkey);
		await db.testPrompt.deleteMany({ where: { testname: testkey } });
		groupsService.removeTestFromAllGroups(filename);
		await db.runHistory.deleteMany({ where: { filename } });
		const aliases = await loadAliases();
		if (aliases[testkey]) {
			delete aliases[testkey];
			await saveAliases(aliases);
		}
	}

	return { listTests, loadAliases, saveAliases, loadRunHistory, recordRunDuration, estimatedMs, deleteTest };
};
