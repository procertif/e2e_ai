const express = require("express");

module.exports = function createCampaignsController({ campaignsRepo, campaignsService, corrections }) {
	const router = express.Router();

	router.get("/campaigns", (req, res) => {
		res.json(campaignsRepo.list());
	});

	router.get("/campaigns/:id", (req, res) => {
		const campaign = campaignsRepo.get(req.params.id);
		if (!campaign) { res.status(404).send("Not found"); return; }
		res.json(campaign);
	});

	router.post("/campaigns", (req, res) => {
		const tests = Array.isArray(req.body?.tests)
			? req.body.tests.filter((t) => typeof t?.filename === "string" && (t.status === "passed" || t.status === "failed" || t.status === "idle"))
			: [];
		if (tests.length === 0) { res.status(400).send("tests required"); return; }
		const campaign = campaignsService.create({
			tests,
			environmentId: req.body?.environmentId != null ? Number(req.body.environmentId) : null,
			environmentName: typeof req.body?.environmentName === "string" ? req.body.environmentName : null,
			durationMs: Number.isFinite(req.body?.durationMs) ? req.body.durationMs : null,
			title: typeof req.body?.title === "string" ? req.body.title.trim() || null : null,
		});
		res.status(201).json(campaign);
	});

	router.put("/campaigns/:id", (req, res) => {
		const campaign = campaignsRepo.get(req.params.id);
		if (!campaign) { res.status(404).send("Not found"); return; }

		let tests = campaign.tests;
		let durationMs = campaign.durationMs;
		if (req.body?.tests !== undefined) {
			const updates = Array.isArray(req.body.tests)
				? req.body.tests.filter((t) => typeof t?.filename === "string" && (t.status === "passed" || t.status === "failed"))
				: [];
			if (updates.length === 0) { res.status(400).send("tests required"); return; }
			({ tests, durationMs } = campaignsService.applyTestUpdates(campaign, updates, req.body?.durationMs));
		}

		let title = campaign.title;
		if (req.body?.title !== undefined) {
			const trimmed = typeof req.body.title === "string" ? req.body.title.trim() : "";
			title = trimmed || null;
		}

		if (req.body?.tests === undefined && req.body?.title === undefined) {
			res.status(400).send("Nothing to update");
			return;
		}

		res.json(campaignsService.save({ ...campaign, title, tests, durationMs }));
	});

	router.delete("/campaigns/:id", (req, res) => {
		campaignsRepo.remove(req.params.id);
		res.sendStatus(204);
	});

	// "Proposer une correction" — drops every failed test of the campaign
	// into the corrections pending set.
	router.post("/campaigns/:id/correction", (req, res) => {
		const campaign = campaignsRepo.get(req.params.id);
		if (!campaign) { res.status(404).send("Not found"); return; }
		res.status(201).json(corrections.createForCampaign(campaign));
	});

	return router;
};
