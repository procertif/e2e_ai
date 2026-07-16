const express = require("express");

module.exports = function createPromptsConfigController({ promptsConfig }) {
	const router = express.Router();

	router.get("/config/prompts", (req, res) => {
		res.json(promptsConfig.getAll());
	});

	router.put("/config/prompts", (req, res) => {
		const body = req.body || {};
		for (const key of promptsConfig.KEYS) {
			const value = body[key];
			if (value != null && typeof value !== "string") {
				res.status(400).send(`${key} must be a string or null`);
				return;
			}
			// 100kB guard: these land in every model call's system blocks.
			if ((value?.length || 0) > 100_000) {
				res.status(400).send("Prompt too long");
				return;
			}
		}
		res.json(promptsConfig.set(body));
	});

	return router;
};
