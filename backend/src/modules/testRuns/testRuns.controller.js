const express = require("express");
const fs = require("fs");
const path = require("path");
const { openEventStream, writeEvent } = require("../../core/http/sse");

module.exports = function createTestRunsController({ testRuns, environmentsRepo, paths }) {
	const router = express.Router();

	router.post("/run/:filename", (req, res) => {
		const filename = req.params.filename;
		if (
			!filename.endsWith(".spec.ts") ||
			path.basename(filename) !== filename ||
			!fs.existsSync(path.join(paths.TESTS_DIR, filename))
		) {
			res.status(400).send("Invalid test file");
			return;
		}
		const environmentId = req.body?.environmentId != null ? Number(req.body.environmentId) : null;
		const environment = Number.isInteger(environmentId) ? environmentsRepo.get(environmentId) : null;
		const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
		const runId = testRuns.startTestRun(filename, baseUrl || undefined, environment);
		res.json({ runId });
	});

	router.post("/kill/:runId", (req, res) => {
		const run = testRuns.get(req.params.runId);
		if (!run || typeof run.kill !== "function") {
			res.status(404).send("Not found");
			return;
		}
		run.kill();
		res.json({ ok: true });
	});

	router.get("/run-status/:runId", (req, res) => {
		const run = testRuns.get(req.params.runId);
		if (!run) { res.sendStatus(404); return; }
		res.json({ status: run.status });
	});

	// Live console stream — replays the buffered lines first so a client
	// connecting mid-run misses nothing.
	router.get("/stream/:runId", (req, res) => {
		const run = testRuns.get(req.params.runId);
		if (!run) { res.sendStatus(404); return; }
		openEventStream(res);
		for (const text of run.lines) {
			writeEvent(res, { text });
		}
		if (run.status !== "running") {
			writeEvent(res, { done: true, status: run.status });
			res.end();
			return;
		}
		run.clients.add(res);
		req.on("close", () => run.clients.delete(res));
	});

	return router;
};
