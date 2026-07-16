const express = require("express");
const { openEventStream, writeEvent } = require("../../core/http/sse");
const { environmentContext } = require("../../ai/prompts");

module.exports = function createChatController({ chatService, environmentsRepo, aiQueue, ai }) {
	const router = express.Router();

	router.post("/chat", async (req, res) => {
		try {
			const { message, images, sessionId, instructions, environmentId, seedHistory } = req.body;
			const hasImages = Array.isArray(images) && images.length > 0;
			if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
				res.status(400).send("Message required");
				return;
			}
			const envId = Number(environmentId);
			if (!Number.isInteger(envId)) {
				res.status(400).send("environmentId required");
				return;
			}
			const environment = environmentsRepo.get(envId);
			if (!environment) {
				res.status(400).send("Environment not found");
				return;
			}
			const mergedInstructions = [environmentContext(environment), instructions].filter(Boolean).join("\n\n") || null;
			const task = await aiQueue.enqueue({
				kind: "conversation",
				targetKey: sessionId || null,
				message: (message || "").trim(),
				images: hasImages ? images : null,
				instructions: mergedInstructions,
				environmentId: envId,
				seedHistory: Array.isArray(seedHistory) ? seedHistory : null,
			});
			res.json({ taskId: task.id, status: task.status, runId: task.runId });
		} catch {
			res.status(400).send("Bad request");
		}
	});

	router.get("/conversations", async (req, res) => {
		try {
			res.json(await chatService.listConversations());
		} catch (err) {
			res.status(500).send(err.message);
		}
	});

	router.get("/chat-logs", async (req, res) => {
		try {
			res.json(await chatService.listChatLogSummaries());
		} catch (err) {
			res.status(500).send(err.message);
		}
	});

	router.get("/chat-logs/:id", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) {
			res.status(400).send("Invalid id");
			return;
		}
		const log = await chatService.getChatLog(id);
		if (!log) {
			res.status(404).send("Not found");
			return;
		}
		res.json(log);
	});

	router.delete("/chat-logs/:id", async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) {
			res.status(400).send("Invalid id");
			return;
		}
		await chatService.deleteChatLog(id);
		res.sendStatus(204);
	});

	router.post("/chat-save", async (req, res) => {
		try {
			const { filename, messages } = req.body;
			if (!filename || !Array.isArray(messages)) {
				res.status(400).send("Invalid payload");
				return;
			}
			const safe = await chatService.saveChat(filename, messages);
			res.json({ ok: true, filename: safe });
		} catch (err) {
			res.status(500).send(err.message);
		}
	});

	router.post("/chat-stop/:runId", (req, res) => {
		const run = ai.getChatRun(req.params.runId);
		if (!run || typeof run.abort !== "function") {
			res.status(404).send("Not found");
			return;
		}
		run.abort();
		res.json({ ok: true });
	});

	// SSE stream of an AI run (classic chat AND correction chat) — replays
	// buffered events first so a client connecting mid-run misses nothing.
	router.get("/chat-stream/:runId", (req, res) => {
		const run = ai.getChatRun(req.params.runId);
		if (!run) { res.sendStatus(404); return; }
		openEventStream(res);
		for (const event of run.events) {
			writeEvent(res, event);
		}
		if (run.status !== "running") {
			res.end();
			return;
		}
		run.clients.add(res);
		req.on("close", () => run.clients.delete(res));
	});

	return router;
};
