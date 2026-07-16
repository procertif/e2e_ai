const { newId } = require("../core/ids");

// In-memory registry of chat runs (classic + correction). Each run buffers
// its SSE events so a client can (re)connect mid-run and replay from the
// start — see the chat module's /chat-stream endpoint.
function createRunRegistry() {
	const runs = new Map();

	function createRun() {
		const runId = newId();
		const run = { events: [], status: "running", clients: new Set(), abort: null };
		runs.set(runId, run);
		const pushEvent = (event) => {
			const text = JSON.stringify(event);
			run.events.push(text);
			for (const res of run.clients) res.write(`data: ${text}\n\n`);
		};
		return { runId, run, pushEvent };
	}

	function finishRun(run, pushEvent, { runId, status, error }) {
		run.status = status === "error" ? "error" : "done";
		pushEvent({ type: "done", status, ...(error ? { error } : {}), sessionId: runId });
		for (const res of run.clients) res.end();
		run.clients.clear();
		if (run.status === "done") {
			setTimeout(() => runs.delete(runId), 5 * 60 * 1000).unref?.();
		}
	}

	return {
		createRun,
		finishRun,
		get: (runId) => runs.get(runId),
	};
}

module.exports = { createRunRegistry };
