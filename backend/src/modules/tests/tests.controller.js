const express = require("express");

module.exports = function createTestsController({ testsService }) {
	const router = express.Router();

	router.get("/tests", async (req, res) => {
		res.json(await testsService.listTests());
	});

	router.delete("/tests/:testkey", async (req, res) => {
		await testsService.deleteTest(req.params.testkey);
		res.sendStatus(204);
	});

	router.get("/test-aliases", async (req, res) => {
		res.json(await testsService.loadAliases());
	});

	router.put("/test-aliases/:testkey", async (req, res) => {
		try {
			const aliases = await testsService.loadAliases();
			const alias = (req.body.alias || "").trim();
			if (alias) {
				aliases[req.params.testkey] = alias;
			} else {
				delete aliases[req.params.testkey];
			}
			await testsService.saveAliases(aliases);
			res.json({ ok: true });
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.delete("/test-aliases/:testkey", async (req, res) => {
		const aliases = await testsService.loadAliases();
		delete aliases[req.params.testkey];
		await testsService.saveAliases(aliases);
		res.sendStatus(204);
	});

	return router;
};
