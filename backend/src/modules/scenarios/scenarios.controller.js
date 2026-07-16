const express = require("express");

module.exports = function createScenariosController({ scenariosRepo, ai, db }) {
	const router = express.Router();

	router.post("/spec-regen/:testname", (req, res) => {
		ai.generateSpec(req.params.testname).catch(() => {});
		res.sendStatus(202);
	});

	router.get("/spec/:testname", (req, res) => {
		const scenario = scenariosRepo.get(req.params.testname);
		if (!scenario?.spec) {
			res.status(404).json({});
			return;
		}
		res.json({ spec: scenario.spec });
	});

	router.get("/actions/:testKey", (req, res) => {
		const scenario = scenariosRepo.get(req.params.testKey);
		if (!scenario) {
			res.status(404).send("Not found");
			return;
		}
		res.json({ test: scenario.testname, file: scenario.file, description: scenario.description, actions: scenario.actions || [] });
	});

	// The chat messages that originally produced this test (saved by the AI
	// conversation run when it wrote the test's action list).
	router.get("/prompt/:testKey", async (req, res) => {
		const prompt = await db.testPrompt.findUnique({ where: { testname: req.params.testKey } });
		if (!prompt) {
			res.status(404).send("Not found");
			return;
		}
		res.json(JSON.parse(prompt.messagesJson));
	});

	return router;
};
