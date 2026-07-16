const express = require("express");
const fs = require("fs");
const path = require("path");
const { isSafeTestname } = require("../../core/safeNames");

module.exports = function createScenariosController({ scenariosRepo, ai, db, paths, aiQueue }) {
	const router = express.Router();

	// Scenario list for the Scenarios page. hasTest tells whether the spec
	// file still exists — a scenario can outlive its test (deleted/renamed).
	// "_"-prefixed entries (_correction_*, _pending_*, …) are runtime
	// artifacts of temp spec runs, not real scenarios.
	router.get("/scenarios", (req, res) => {
		const list = scenariosRepo
			.list()
			.filter((s) => s.testname && !s.testname.startsWith("_"))
			.map((s) => ({
				testname: s.testname,
				title: s.title || null,
				hasTest: fs.existsSync(path.join(paths.TESTS_DIR, s.testname + ".spec.ts")),
				hasSpec: Boolean(s.spec),
				updatedAt: s.updatedAt || null,
			}))
			.sort((a, b) => a.testname.localeCompare(b.testname));
		res.json(list);
	});

	// Create an empty scenario (Scenarios page "Ajouter"). The user provides a
	// human title ("Capture de l'inventaire"); the file/test name is derived
	// from it — accents stripped, lowercased, snake_cased — and shares the
	// testname constraints so a test generated later from it can reuse it.
	router.post("/scenarios", (req, res) => {
		const title = String(req.body?.title || "").trim();
		if (!title || title.length > 120) { res.status(400).send("Title required (max 120 chars)."); return; }
		const name = title
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
		if (!name || !isSafeTestname(name) || !/^[a-z0-9][a-z0-9_]*$/.test(name)) {
			res.status(400).send("Title must contain at least one letter or digit.");
			return;
		}
		if (scenariosRepo.get(name)) { res.status(409).send("Scenario already exists."); return; }
		res.status(201).json(scenariosRepo.upsert(name, { spec: "", title }));
	});

	// Scenario detail for the Scenarios page: spec + chat history.
	router.get("/scenarios/:testname", (req, res) => {
		const scenario = scenariosRepo.get(req.params.testname);
		if (!scenario) { res.status(404).send("Not found"); return; }
		res.json({ testname: scenario.testname, title: scenario.title || null, spec: scenario.spec || "", chatMessages: scenario.chatMessages || [] });
	});

	// Scenario-scoped chat — same global AI queue and /chat-stream machinery
	// as classic chat and corrections.
	router.post("/scenarios/:testname/chat", async (req, res) => {
		try {
			const { message, images, environmentId } = req.body || {};
			const hasImages = Array.isArray(images) && images.length > 0;
			if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
				res.status(400).send("Message required");
				return;
			}
			if (!scenariosRepo.get(req.params.testname)) { res.status(404).send("Not found"); return; }
			const envId = Number(environmentId);
			const task = await aiQueue.enqueue({
				kind: "scenario",
				targetKey: req.params.testname,
				message: (message || "").trim(),
				images: hasImages ? images : null,
				environmentId: Number.isInteger(envId) ? envId : null,
			});
			res.json({ taskId: task.id, status: task.status, runId: task.runId });
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

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
