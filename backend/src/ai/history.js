// Pure helpers that repair/prepare a conversation history before it's sent
// to the Anthropic API.

// The Anthropic API hard-rejects (400, on every future call — not just the
// one that would've completed the pairing) any conversation where a tool_use
// block isn't immediately followed by its tool_result. That can happen from
// an older build of this app that used to drop toolResults whenever a run
// was aborted mid-tool-execution (fixed in the run loops) — this repairs any
// conversation already left in that state by synthesizing a placeholder
// tool_result for each orphaned tool_use, so a stuck conversation heals
// itself the next time it's used instead of silently 400ing forever.
// Mutates history in place and is a no-op on an already-valid one, so it's
// safe to run unconditionally on every turn.
function sanitizeToolUseHistory(history) {
	for (let i = 0; i < history.length; i++) {
		const msg = history[i];
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
		const toolUseIds = msg.content.filter((b) => b?.type === "tool_use").map((b) => b.id);
		if (toolUseIds.length === 0) continue;
		const next = history[i + 1];
		const nextResultIds = new Set(
			next?.role === "user" && Array.isArray(next.content)
				? next.content.filter((b) => b?.type === "tool_result").map((b) => b.tool_use_id)
				: [],
		);
		const missing = toolUseIds.filter((id) => !nextResultIds.has(id));
		if (missing.length === 0) continue;
		const placeholders = missing.map((id) => ({
			type: "tool_result",
			tool_use_id: id,
			content: "(Interrompu avant que ce résultat ne soit enregistré.)",
		}));
		if (next?.role === "user" && Array.isArray(next.content) && next.content.every((b) => b?.type === "tool_result")) {
			next.content = [...next.content, ...placeholders];
		} else {
			history.splice(i + 1, 0, { role: "user", content: placeholders });
		}
	}
	return history;
}

// Historical messages fetched from the DB have images redacted down to
// { type: "image", media_type } (no source) to keep chat_log rows small —
// that shape isn't valid Anthropic API input, so when a client resumes an
// old conversation and seeds it back in (because the in-memory history cache
// missed — server restarted or LRU-evicted), swap those out for a text
// placeholder rather than sending malformed content.
function sanitizeSeedHistory(messages) {
	if (!Array.isArray(messages)) return [];
	const fixBlock = (b) => (b && b.type === "image" && !b.source ? { type: "text", text: "[image]" } : b);
	return messages.map((msg) => {
		if (!Array.isArray(msg.content)) return msg;
		return {
			...msg,
			content: msg.content.map((b) => {
				if (b?.type === "tool_result" && Array.isArray(b.content)) {
					return { ...b, content: b.content.map(fixBlock) };
				}
				return fixBlock(b);
			}),
		};
	});
}

// Marks the last content block of the last message with an ephemeral cache
// breakpoint, without mutating the caller's history array — otherwise the
// tag would pile up on every past turn as the conversation grows. Without
// this, every API call in the tool-use loop re-sends (and re-pays for) the
// entire accumulated history: tool outputs, file reads, images, etc.
function withCachedTail(messages) {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1];
	const blocks = typeof last.content === "string"
		? [{ type: "text", text: last.content }]
		: last.content.map((b) => ({ ...b }));
	if (blocks.length === 0) return messages;
	blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
	return [...messages.slice(0, -1), { ...last, content: blocks }];
}

module.exports = { sanitizeToolUseHistory, sanitizeSeedHistory, withCachedTail };
