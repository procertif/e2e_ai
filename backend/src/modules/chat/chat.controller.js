const express = require("express");
const { openEventStream, writeEvent } = require("../../core/http/sse");

module.exports = function createChatController({ chatService, ai }) {
	const router = express.Router();

	// The standalone Conversation page is gone — this module now only serves
	// the shared run streaming (/chat-stream, /chat-stop, reachable from
	// corrections/creations/scenario chats) and the chat-log history page.

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
