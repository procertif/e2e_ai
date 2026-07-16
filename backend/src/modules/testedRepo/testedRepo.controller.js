const express = require("express");

module.exports = function createTestedRepoController({ testedRepo, environmentsRepo, environmentsService }) {
	const router = express.Router();
	// Per-branch fetch state, kept after completion (not just a dedup set) so
	// the Environments page can leave and come back — or be reloaded — while a
	// clone/fetch runs and still show the spinner, then the error if any.
	// Keyed by branch like the checkouts themselves: two environments on the
	// same branch share one fetch.
	const fetchStates = new Map(); // branch -> { status: "running"|"done"|"error", error, startedAt, endedAt }

	router.get("/repo/branches", async (req, res) => {
		if (!testedRepo.isConfigured()) { res.status(400).send("GITHUB_TOKEN / GITHUB_REPO_URL not configured."); return; }
		try {
			res.json(await testedRepo.listBranches());
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	router.get("/repo/fetch-status", (req, res) => {
		res.json(Object.fromEntries(fetchStates));
	});

	router.post("/environments/:id/fetch", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
		const environment = environmentsRepo.get(id);
		if (!environment) { res.status(404).send("Not found"); return; }
		const branch = environment.branch;
		if (!branch) { res.status(400).send("No branch configured for this environment."); return; }
		if (!testedRepo.isConfigured()) { res.status(400).send("GITHUB_TOKEN / GITHUB_REPO_URL not configured."); return; }
		if (fetchStates.get(branch)?.status === "running") { res.status(409).send("A fetch is already in progress for this branch."); return; }
		fetchStates.set(branch, { status: "running", error: null, startedAt: Date.now(), endedAt: null });
		try {
			await testedRepo.fetchRepo(branch);
			fetchStates.set(branch, { status: "done", error: null, startedAt: fetchStates.get(branch).startedAt, endedAt: Date.now() });
			res.json({ ...environment, ...(await environmentsService.branchStatus(branch)) });
		} catch (err) {
			fetchStates.set(branch, { status: "error", error: err.message, startedAt: fetchStates.get(branch).startedAt, endedAt: Date.now() });
			res.status(502).send(err.message);
		}
	});

	return router;
};
