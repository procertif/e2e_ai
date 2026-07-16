const express = require("express");

module.exports = function createPromptsConfigController({ promptsConfig }) {
	const router = express.Router();

	router.get("/config/prompts", (req, res) => {
		res.json(promptsConfig.getAll());
	});

	router.put("/config/prompts", (req, res) => {
		const { classic, correction } = req.body || {};
		if ((classic != null && typeof classic !== "string") || (correction != null && typeof correction !== "string")) {
			res.status(400).send("classic/correction must be strings or null");
			return;
		}
		// 100kB guard: these land in every model call's system blocks.
		if ((classic?.length || 0) > 100_000 || (correction?.length || 0) > 100_000) {
			res.status(400).send("Prompt too long");
			return;
		}
		res.json(promptsConfig.set({ classic, correction }));
	});

	return router;
};
