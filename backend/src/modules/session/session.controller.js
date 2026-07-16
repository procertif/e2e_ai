const express = require("express");

// Persists the Tests page's last run selection (all/failed) so it survives
// reloads — a single row, always id 1.
module.exports = function createSessionController({ db }) {
	const router = express.Router();

	router.post("/session", async (req, res) => {
		try {
			const all = Array.isArray(req.body.all) ? req.body.all : [];
			const failed = Array.isArray(req.body.failed) ? req.body.failed : [];
			await db.session.upsert({
				where: { id: 1 },
				create: { id: 1, allJson: JSON.stringify(all), failedJson: JSON.stringify(failed) },
				update: { allJson: JSON.stringify(all), failedJson: JSON.stringify(failed) },
			});
			res.sendStatus(204);
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.get("/session", async (req, res) => {
		const session = await db.session.findUnique({ where: { id: 1 } });
		if (!session) {
			res.status(404).send("No session");
			return;
		}
		res.json({ all: JSON.parse(session.allJson), failed: JSON.parse(session.failedJson) });
	});

	return router;
};
