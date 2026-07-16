const express = require("express");

module.exports = function createTestedRepoController({ testedRepo, environmentsRepo, environmentsService }) {
	const router = express.Router();
	const fetchesInProgress = new Set();

	router.get("/repo/branches", async (req, res) => {
		if (!testedRepo.isConfigured()) { res.status(400).send("GITHUB_TOKEN / GITHUB_REPO_URL not configured."); return; }
		try {
			res.json(await testedRepo.listBranches());
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	router.post("/environments/:id/fetch", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
		const environment = environmentsRepo.get(id);
		if (!environment) { res.status(404).send("Not found"); return; }
		const branch = environment.branch;
		if (!branch) { res.status(400).send("No branch configured for this environment."); return; }
		if (!testedRepo.isConfigured()) { res.status(400).send("GITHUB_TOKEN / GITHUB_REPO_URL not configured."); return; }
		if (fetchesInProgress.has(branch)) { res.status(409).send("A fetch is already in progress for this branch."); return; }
		fetchesInProgress.add(branch);
		try {
			await testedRepo.fetchRepo(branch);
			res.json({ ...environment, ...(await environmentsService.branchStatus(branch)) });
		} catch (err) {
			res.status(502).send(err.message);
		} finally {
			fetchesInProgress.delete(branch);
		}
	});

	return router;
};
