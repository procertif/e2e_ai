const express = require("express");

module.exports = function createCreationsController({ creations, aiQueue, scenariosRepo, testsService }) {
	const router = express.Router();

	function parseEnvironmentId(value) {
		return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
	}

	router.get("/creations", (req, res) => {
		res.json(creations.list());
	});

	router.get("/creations/:filename", (req, res) => {
		const entry = creations.get(req.params.filename);
		if (!entry) { res.status(404).send("Not found"); return; }
		res.json(entry);
	});

	// "Nouveau test" — an empty draft entry the user then builds through the
	// IA tab and/or the editor, and validates into a real spec file. Either
	// anchored to an existing scenario (picked in the modal — the draft takes
	// its testname and the flow starts directly in the test-building state),
	// or without one: the testname derives from the title, an empty scenario
	// record is registered, and the flow starts in the "write the scenario
	// first" state.
	router.post("/creations", (req, res) => {
		try {
			const scenarioTestname = String(req.body?.scenarioTestname || "").trim();
			if (scenarioTestname && !scenariosRepo.get(scenarioTestname)) {
				res.status(400).send("Unknown scenario.");
				return;
			}
			const entry = creations.create(req.body?.title, scenarioTestname || null, parseEnvironmentId(req.body?.environmentId));
			if (!scenarioTestname) {
				const testname = entry.filename.replace(/\.spec\.ts$/, "");
				// Only if truly absent — an existing unpicked scenario with the
				// same slug must keep its spec (upsert would wipe it with "").
				if (!scenariosRepo.get(testname)) scenariosRepo.upsert(testname, { spec: "", title: entry.title });
			}
			res.status(201).json(entry);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	// State switch of the creation flow. Validating (true) requires a
	// non-empty scenario spec — that's the gate between "write the scenario"
	// and "build the test"; false is the Scénario tab's "Éditer" button.
	// Validation also kicks off the test-building AI right away (same task
	// as the batch), so the user lands in state 2 with the creation already
	// running.
	router.post("/creations/:filename/scenario-validated", async (req, res) => {
		try {
			const validated = Boolean(req.body?.validated);
			if (validated) {
				const testname = req.params.filename.replace(/\.spec\.ts$/, "");
				if (!scenariosRepo.get(testname)?.spec?.trim()) {
					res.status(400).send("The scenario spec is empty.");
					return;
				}
			}
			const entry = creations.setScenarioValidated(req.params.filename, validated);
			if (validated) {
				await aiQueue.enqueue({
					kind: "creation",
					targetKey: req.params.filename,
					message: "Crée ce test à partir de son scénario (résultat attendu).",
					environmentId: parseEnvironmentId(req.body?.environmentId) ?? entry.environmentId ?? null,
				});
			}
			res.json(entry);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.delete("/creations/:filename", (req, res) => {
		creations.remove(req.params.filename);
		res.sendStatus(204);
	});

	router.put("/creations/:filename", (req, res) => {
		if (!creations.isSafeTestFilename(req.params.filename)) { res.status(400).send("Invalid filename"); return; }
		if (typeof req.body?.content !== "string") { res.status(400).send("content required"); return; }
		const entry = creations.updateDraft(req.params.filename, req.body.content, "user");
		if (!entry) { res.status(404).send("Not found"); return; }
		res.json(entry);
	});

	router.post("/creations/:filename/validate", async (req, res) => {
		try {
			const entry = creations.get(req.params.filename);
			const result = creations.validate(req.params.filename);
			// The filename is a slug of the title — keep the human title the user
			// typed as the test's alias, so every list keeps displaying it.
			if (entry?.title) {
				const aliases = await testsService.loadAliases();
				aliases[req.params.filename.replace(/\.spec\.ts$/, "")] = entry.title;
				await testsService.saveAliases(aliases);
			}
			res.json(result);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	// The creation batch's "Démarrer" — N creation tasks dropped on the
	// global AI queue at once, exactly like the corrections batch. The
	// queue's ordering, per-target dedup, pause and cancel are the batch
	// machinery; no separate runner.
	router.post("/creations/batch-chat", async (req, res) => {
		try {
			const { filenames, environmentId } = req.body || {};
			if (!Array.isArray(filenames) || filenames.length === 0) {
				res.status(400).send("filenames required");
				return;
			}
			const envId = parseEnvironmentId(environmentId);
			const tasks = [];
			for (const filename of filenames) {
				if (!creations.isSafeTestFilename(filename) || !creations.get(filename)) continue;
				const task = await aiQueue.enqueue({
					kind: "creation",
					targetKey: filename,
					message: "Crée ce test à partir de son scénario (résultat attendu).",
					environmentId: envId,
				});
				tasks.push({ taskId: task.id, filename, status: task.status });
			}
			res.json(tasks);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.post("/creations/batch-stop", async (req, res) => {
		res.json(await aiQueue.cancelCreations());
	});

	// Chat scoped to one test in creation — enqueued on the same global AI
	// queue as classic Chat and corrections, and streamed over the same
	// /chat-stream / /chat-stop machinery (see the chat module).
	router.post("/creations/:filename/chat", async (req, res) => {
		try {
			const { message, images, environmentId } = req.body || {};
			const hasImages = Array.isArray(images) && images.length > 0;
			if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
				res.status(400).send("Message required");
				return;
			}
			if (!creations.get(req.params.filename)) { res.status(404).send("Not found"); return; }
			const task = await aiQueue.enqueue({
				kind: "creation",
				targetKey: req.params.filename,
				message: (message || "").trim(),
				images: hasImages ? images : null,
				environmentId: parseEnvironmentId(environmentId),
			});
			res.json({ taskId: task.id, status: task.status, runId: task.runId });
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	return router;
};
