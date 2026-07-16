// Server-Sent Events plumbing shared by every streaming endpoint.

function openEventStream(res) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
}

function writeEvent(res, payload) {
	res.write(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`);
}

module.exports = { openEventStream, writeEvent };
