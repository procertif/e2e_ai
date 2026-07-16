const { newId } = require("../../core/ids");

function countTests(tests) {
	const passed = tests.filter((t) => t.status === "passed").length;
	const failed = tests.filter((t) => t.status === "failed").length;
	return { passed, failed, total: tests.length };
}

module.exports = function createCampaignsService({ campaignsRepo }) {
	function create({ tests, environmentId, environmentName, durationMs, title }) {
		const now = Date.now();
		return campaignsRepo.save({
			id: newId(),
			title,
			createdAt: now,
			updatedAt: now,
			environmentId,
			environmentName,
			durationMs,
			tests,
			...countTests(tests),
		});
	}

	// Merges per-test status/output updates into the stored campaign — tests
	// absent from the update keep their previous state.
	function applyTestUpdates(campaign, updates, durationMs) {
		const byFilename = Object.fromEntries(updates.map((t) => [t.filename, t]));
		const tests = campaign.tests.map((t) =>
			byFilename[t.filename]
				? { ...t, status: byFilename[t.filename].status, output: typeof byFilename[t.filename].output === "string" ? byFilename[t.filename].output : t.output }
				: t
		);
		return { tests, durationMs: Number.isFinite(durationMs) ? durationMs : campaign.durationMs };
	}

	function save(campaign) {
		return campaignsRepo.save({ ...campaign, updatedAt: Date.now(), ...countTests(campaign.tests) });
	}

	return { create, applyTestUpdates, save };
};

module.exports.countTests = countTests;
