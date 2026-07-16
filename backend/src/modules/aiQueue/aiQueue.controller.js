const express = require("express");

module.exports = function createAiQueueController({ aiQueue }) {
	const router = express.Router();

	// Queued/running AI tasks (conversation + correction) — lets any
	// component, regardless of what started a task or whether it's even still
	// mounted, answer "what's the status of task N" or "is anything
	// queued/running for this filename/conversation right now" after a reload
	// or a tab switch.
	router.get("/ai-queue", async (req, res) => {
		res.json({ paused: aiQueue.isPaused(), correctionsPaused: aiQueue.isCorrectionsPaused(), tasks: await aiQueue.list() });
	});

	// The queue pauses itself at startup when tasks were stranded by the last
	// shutdown — this is the UI's way of letting it go again.
	router.post("/ai-queue/resume", (req, res) => {
		aiQueue.resume();
		res.json({ paused: aiQueue.isPaused() });
	});

	// Pause/resume for correction-kind tasks only (the Corrections page's
	// batch controls) — conversation tasks keep flowing while corrections are
	// held.
	router.post("/ai-queue/corrections-pause", (req, res) => {
		aiQueue.pauseCorrections();
		res.json({ correctionsPaused: aiQueue.isCorrectionsPaused() });
	});

	router.post("/ai-queue/corrections-resume", (req, res) => {
		aiQueue.resumeCorrections();
		res.json({ correctionsPaused: aiQueue.isCorrectionsPaused() });
	});

	router.get("/ai-queue/:id", async (req, res) => {
		const task = await aiQueue.get(req.params.id);
		if (!task) { res.status(404).send("Not found"); return; }
		res.json({ id: task.id, kind: task.kind, targetKey: task.targetKey, status: task.status, runId: task.runId });
	});

	// Only succeeds while the task is still queued — a running one has to be
	// stopped via POST /chat-stop/:runId instead.
	router.delete("/ai-queue/:id", async (req, res) => {
		const cancelled = await aiQueue.cancel(req.params.id);
		res.json({ cancelled });
	});

	return router;
};
