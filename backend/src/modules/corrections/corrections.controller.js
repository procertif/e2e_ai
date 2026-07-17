const express = require("express");

module.exports = function createCorrectionsController({ corrections, aiQueue, environmentsRepo, scenariosRepo }) {
	const router = express.Router();

	function parseEnvironmentId(value) {
		return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
	}

	router.get("/corrections", (req, res) => {
		res.json(corrections.list());
	});

	// Send one test to correction from the execution queue — no campaign
	// involved; the caller passes the last run's console output if it has one.
	router.post("/corrections", (req, res) => {
		try {
			const { filename, consoleOutput, environmentId } = req.body || {};
			const envId = parseEnvironmentId(environmentId);
			const entry = corrections.createForTest(String(filename || ""), {
				consoleOutput: typeof consoleOutput === "string" ? consoleOutput : "",
				environmentId: envId,
				environmentName: envId != null ? environmentsRepo.get(envId)?.name ?? null : null,
			});
			res.status(201).json(entry);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.get("/corrections/:filename", (req, res) => {
		const entry = corrections.get(req.params.filename);
		if (!entry) { res.status(404).send("Not found"); return; }
		res.json(entry);
	});

	router.delete("/corrections/:filename", (req, res) => {
		corrections.remove(req.params.filename);
		res.sendStatus(204);
	});

	router.put("/corrections/:filename", (req, res) => {
		if (!corrections.isSafeTestFilename(req.params.filename)) { res.status(400).send("Invalid filename"); return; }
		if (typeof req.body?.content !== "string") { res.status(400).send("content required"); return; }
		const entry = corrections.updateDraft(req.params.filename, req.body.content, "user");
		if (!entry) { res.status(404).send("Not found"); return; }
		res.json(entry);
	});

	router.post("/corrections/:filename/validate", (req, res) => {
		try {
			res.json(corrections.validate(req.params.filename));
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	// The Corrections page's "Démarrer" — the whole batch is just N correction
	// tasks dropped on the global AI queue at once. The queue's own ordering,
	// per-target dedup, pause and cancel are the batch machinery; there is no
	// separate batch runner, so its state survives reloads and other tabs.
	router.post("/corrections/batch-chat", async (req, res) => {
		try {
			const { filenames, environmentId } = req.body || {};
			if (!Array.isArray(filenames) || filenames.length === 0) {
				res.status(400).send("filenames required");
				return;
			}
			const envId = parseEnvironmentId(environmentId);
			const tasks = [];
			for (const filename of filenames) {
				if (!corrections.isSafeTestFilename(filename) || !corrections.get(filename)) continue;
				const task = await aiQueue.enqueue({
					kind: "correction",
					targetKey: filename,
					message: "Essaye de corriger ce test.",
					environmentId: envId,
				});
				tasks.push({ taskId: task.id, filename, status: task.status });
			}
			res.json(tasks);
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.post("/corrections/batch-stop", async (req, res) => {
		res.json(await aiQueue.cancelCorrections());
	});

	// The scenario-edit proposal banner's two outcomes. Accept opens the
	// handoff: the correction AI's message becomes the first instruction of a
	// scenario-assistant task (the UI switches to the scenario editor and
	// attaches to it); either way the proposal is cleared.
	router.post("/corrections/:filename/accept-scenario-edit", async (req, res) => {
		try {
			const entry = corrections.get(req.params.filename);
			if (!entry?.scenarioEditProposal?.message) { res.status(400).send("No pending scenario-edit proposal."); return; }
			const testname = req.params.filename.replace(/\.spec\.ts$/, "");
			// The scenario task would be silently dropped by the queue if no
			// scenario record exists — register an empty one instead so the
			// assistant can write the spec from scratch.
			if (!scenariosRepo.get(testname)) scenariosRepo.upsert(testname, { spec: "" });
			const task = await aiQueue.enqueue({
				kind: "scenario",
				targetKey: testname,
				message: entry.scenarioEditProposal.message,
				environmentId: parseEnvironmentId(req.body?.environmentId) ?? entry.environmentId ?? null,
			});
			corrections.setScenarioEditProposal(req.params.filename, null);
			res.json({ taskId: task.id, status: task.status, runId: task.runId });
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	router.post("/corrections/:filename/dismiss-scenario-edit", (req, res) => {
		corrections.setScenarioEditProposal(req.params.filename, null);
		res.sendStatus(204);
	});

	// Called when the user validates the edited scenario (exit of the
	// scenario-edition stage): automatically tells the correction AI that the
	// specification changed — with its new content, since the spec is only
	// injected on the conversation's first turn — so it updates the test.
	router.post("/corrections/:filename/scenario-updated", async (req, res) => {
		try {
			const entry = corrections.get(req.params.filename);
			if (!entry) { res.status(404).send("Not found"); return; }
			const spec = scenariosRepo.get(req.params.filename.replace(/\.spec\.ts$/, ""))?.spec || "";
			const message = `[Contexte automatique] Le scénario (résultat attendu) de ce test vient d'être modifié et validé par l'utilisateur. Nouvelle spécification :\n\`\`\`\n${spec}\n\`\`\`\nMets à jour le test pour qu'il vérifie exactement ce nouveau comportement, puis vérifie avec RunTest.`;
			const task = await aiQueue.enqueue({
				kind: "correction",
				targetKey: req.params.filename,
				message,
				environmentId: parseEnvironmentId(req.body?.environmentId) ?? entry.environmentId ?? null,
			});
			res.json({ taskId: task.id, status: task.status, runId: task.runId });
		} catch (err) {
			res.status(400).send(err.message);
		}
	});

	// Chat scoped to one test in correction — enqueued on the same global AI
	// queue as classic Chat, and once started, streamed over the same generic
	// /chat-stream / /chat-stop machinery (see the chat module).
	router.post("/corrections/:filename/chat", async (req, res) => {
		try {
			const { message, images, environmentId } = req.body || {};
			const hasImages = Array.isArray(images) && images.length > 0;
			if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
				res.status(400).send("Message required");
				return;
			}
			const task = await aiQueue.enqueue({
				kind: "correction",
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
