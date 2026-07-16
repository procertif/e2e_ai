const path = require("path");

// Read-side of the chat feature: conversation/log listings assembled from
// the chat_logs table (written by the AI conversation run).
module.exports = function createChatService({ db }) {
	function firstUserText(messages) {
		const userMessages = messages.filter((m) => m.role === "user");
		const first = userMessages[0];
		if (!first) return { title: null, messageCount: 0 };
		let title = null;
		if (typeof first.content === "string") title = first.content;
		else if (Array.isArray(first.content)) title = first.content.find((b) => b.type === "text")?.text || null;
		return { title, messageCount: userMessages.length };
	}

	// Chat turns are logged one row per message send — a "conversation" is
	// the latest row for a given conversationId, whose messages already
	// contain the full accumulated transcript.
	async function listConversations() {
		const rows = await db.chatLog.findMany({
			orderBy: { startedAt: "desc" },
			select: { id: true, runId: true, conversationId: true, startedAt: true, messages: true },
		});
		const latestByConversation = new Map();
		for (const row of rows) {
			const key = row.conversationId || row.runId;
			if (!latestByConversation.has(key)) latestByConversation.set(key, row);
		}
		return [...latestByConversation.values()].map((row) => {
			let title = null;
			let messageCount = 0;
			try {
				const messages = JSON.parse(row.messages);
				if (Array.isArray(messages)) ({ title, messageCount } = firstUserText(messages));
			} catch {}
			return {
				conversationId: row.conversationId || row.runId,
				latestChatLogId: row.id,
				latestRunId: row.runId,
				updatedAt: row.startedAt,
				title: title ? title.slice(0, 80) : null,
				messageCount,
			};
		});
	}

	async function listChatLogSummaries() {
		const logs = await db.chatLog.findMany({
			orderBy: { startedAt: "desc" },
			select: { id: true, startedAt: true, endedAt: true, durationMs: true, totals: true, messages: true },
		});
		return logs.map((log) => {
			let messageCount = 0;
			try {
				const messages = JSON.parse(log.messages);
				messageCount = Array.isArray(messages) ? messages.filter((m) => m.role === "user").length : 0;
			} catch {}
			let totals = null;
			try { totals = log.totals ? JSON.parse(log.totals) : null; } catch {}
			return { id: log.id, startedAt: log.startedAt, endedAt: log.endedAt, durationMs: log.durationMs, totals, messageCount };
		});
	}

	async function getChatLog(id) {
		const log = await db.chatLog.findUnique({ where: { id } });
		if (!log) return null;
		return {
			runId: log.runId,
			startedAt: log.startedAt,
			endedAt: log.endedAt,
			durationMs: log.durationMs,
			totals: log.totals ? JSON.parse(log.totals) : null,
			apiCalls: log.apiCalls ? JSON.parse(log.apiCalls) : [],
			messages: JSON.parse(log.messages),
		};
	}

	async function deleteChatLog(id) {
		await db.chatLog.deleteMany({ where: { id } });
	}

	async function saveChat(filename, messages) {
		const safe = path.basename(filename).replace(/[^a-zA-Z0-9_\-.]/g, "_");
		await db.savedChat.upsert({
			where: { filename: safe },
			create: { filename: safe, messagesJson: JSON.stringify(messages) },
			update: { messagesJson: JSON.stringify(messages) },
		});
		return safe;
	}

	return { listConversations, listChatLogSummaries, getChatLog, deleteChatLog, saveChat };
};
