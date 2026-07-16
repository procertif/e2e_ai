const express = require("express");

module.exports = function createPendingController({ pendingService, testRuns, environmentsRepo }) {
	const router = express.Router();

	router.get("/pending", (req, res) => {
		res.json(pendingService.list());
	});

	router.all("/pending/:testname/:action(run|confirm|discard)", (req, res) => {
		const { testname, action } = req.params;
		if (!pendingService.exists(testname)) { res.status(404).send("Not found"); return; }

		if (action === "confirm") {
			pendingService.confirm(testname);
			res.json({ ok: true });
			return;
		}
		if (action === "discard") {
			pendingService.discard(testname);
			res.json({ ok: true });
			return;
		}
		// action === "run" — preview execution of the staged spec.
		const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
		const environmentId = req.body?.environmentId != null ? Number(req.body.environmentId) : null;
		const environment = Number.isInteger(environmentId) ? environmentsRepo.get(environmentId) : null;
		const runId = testRuns.startPendingRun(testname, { baseUrl, environment });
		res.json({ runId });
	});

	return router;
};
