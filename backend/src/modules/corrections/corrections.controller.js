const express = require("express");

module.exports = function createCorrectionsController({ corrections, aiQueue }) {
	const router = express.Router();

	function parseEnvironmentId(value) {
		return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
	}

	router.get("/corrections", (req, res) => {
		res.json(corrections.list());
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
