const express = require("express");
const ENVIRONMENT_COLORS = require("./environmentColors");
const { sanitizeVariables, isValidColor } = require("./environments.service");

module.exports = function createEnvironmentsController({ environmentsRepo, environmentsService }) {
	const router = express.Router();

	router.get("/environment-colors", (req, res) => {
		res.json(ENVIRONMENT_COLORS);
	});

	router.get("/environments", async (req, res) => {
		res.json(await environmentsService.listWithUpdateStatus());
	});

	router.post("/environments", async (req, res) => {
		const name = (req.body.name || "").trim();
		const url = (req.body.url || "").trim();
		const color = req.body.color;
		if (!name || !url) { res.status(400).send("Name and url required"); return; }
		if (!isValidColor(color)) { res.status(400).send("Invalid color"); return; }
		const variables = sanitizeVariables(req.body.variables);
		if (variables === null) { res.status(400).send("Invalid variables"); return; }
		const branch = typeof req.body.branch === "string" ? req.body.branch.trim() || null : null;
		try {
			const environment = environmentsService.create({ name, url, variables, color, branch });
			res.status(201).json(environment);
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.put("/environments/:id", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
		const data = {};
		if (req.body.name !== undefined) {
			const name = String(req.body.name).trim();
			if (!name) { res.status(400).send("Name required"); return; }
			data.name = name;
		}
		if (req.body.url !== undefined) {
			const url = String(req.body.url).trim();
			if (!url) { res.status(400).send("Url required"); return; }
			data.url = url;
		}
		if (req.body.variables !== undefined) {
			const variables = sanitizeVariables(req.body.variables);
			if (variables === null) { res.status(400).send("Invalid variables"); return; }
			data.variables = variables;
		}
		if (req.body.color !== undefined) {
			if (!isValidColor(req.body.color)) { res.status(400).send("Invalid color"); return; }
			data.color = req.body.color;
		}
		let previousBranch = null;
		if (req.body.branch !== undefined) {
			previousBranch = environmentsRepo.get(id)?.branch || null;
			data.branch = typeof req.body.branch === "string" ? req.body.branch.trim() || null : null;
		}
		const environment = environmentsService.update(id, data, previousBranch);
		if (!environment) { res.status(404).send("Not found"); return; }
		res.json({ ...environment, ...(await environmentsService.branchStatus(environment.branch)) });
	});

	router.delete("/environments/:id", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
		environmentsService.remove(id);
		res.sendStatus(204);
	});

	return router;
};
