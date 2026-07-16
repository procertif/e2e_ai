const express = require("express");

module.exports = function createGroupsController({ groupsService }) {
	const router = express.Router();

	router.get("/groups", (req, res) => {
		res.json(groupsService.list());
	});

	router.post("/groups", (req, res) => {
		try {
			const name = (req.body.name || "").trim();
			if (!name) { res.status(400).send("Name required"); return; }
			const group = groupsService.create(name);
			res.status(201).json({ id: group.id, name: group.name, tests: group.tests });
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.put("/groups/:id", (req, res) => {
		try {
			const changes = {};
			if (req.body.name !== undefined) changes.name = String(req.body.name).trim();
			if (Array.isArray(req.body.tests)) changes.tests = req.body.tests;
			const group = groupsService.update(req.params.id, changes);
			if (!group) { res.status(404).send("Not found"); return; }
			res.json({ id: group.id, name: group.name, tests: group.tests });
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.delete("/groups/:id", (req, res) => {
		if (!groupsService.remove(req.params.id)) { res.status(404).send("Not found"); return; }
		res.sendStatus(204);
	});

	return router;
};
