const express = require("express");

// Versioned repo backup (data/versioned/ <-> TEST_GITHUB_REPO_URL) —
// read-only diff/status for the Backups tab, plus push/fetch. No endpoint
// here ever creates a branch — always the one the remote already has.
module.exports = function createVersionedRepoController({ versionedRepo }) {
	const router = express.Router();

	router.get("/versioned-repo/status", async (req, res) => {
		try {
			res.json(await versionedRepo.getStatus());
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	// Live step trace of the current/last sync·push·resolve — polled by the
	// frontend while its POST is in flight, re-read once after it settles.
	router.get("/versioned-repo/operation", (req, res) => {
		res.json(versionedRepo.getLastOperation());
	});

	router.post("/versioned-repo/sync", async (req, res) => {
		try {
			const result = await versionedRepo.sync();
			if (result.conflict) { res.status(409).json(result); return; }
			res.json(result);
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	router.get("/versioned-repo/diff", async (req, res) => {
		try {
			res.json(await versionedRepo.getDiff());
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	router.get("/versioned-repo/diff/file", async (req, res) => {
		const file = typeof req.query.path === "string" ? req.query.path : "";
		if (!file) { res.status(400).send("path required"); return; }
		try {
			res.type("text/plain").send(await versionedRepo.getFileDiff(file));
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.post("/versioned-repo/push", async (req, res) => {
		try {
			const result = await versionedRepo.push();
			if (result.conflict) { res.status(409).json(result); return; }
			res.json(result);
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	router.post("/versioned-repo/resolve-conflict", async (req, res) => {
		const resolution = req.body?.resolution;
		if (resolution !== "local" && resolution !== "remote") { res.status(400).send('resolution must be "local" or "remote"'); return; }
		try {
			res.json(await versionedRepo.resolveConflict(resolution));
		} catch (err) {
			res.status(502).send(err.message);
		}
	});

	return router;
};
