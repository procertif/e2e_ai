const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { withCachedTail } = require("./history");
const { classicSystemBlocks } = require("./prompts");
const TOOLS = require("./tools/definitions");

// Thin Anthropic API client: OAuth token management (Claude Code
// credentials, refreshed when close to expiry) + one streaming
// /v1/messages call with tool-use support.
module.exports = function createAnthropicClient({ envLocal, promptsConfig }) {
	const ANTHROPIC_CLIENT_ID = envLocal.ANTHROPIC_CLIENT_ID || process.env.ANTHROPIC_CLIENT_ID;
	const ANTHROPIC_MODEL = envLocal.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL;
	const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

	async function getOAuthToken() {
		const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
		const oauth = creds.claudeAiOauth;
		if (!oauth?.accessToken) throw new Error('No OAuth credentials found. Run "claude login" first.');

		if (Date.now() >= (oauth.expiresAt || 0) - 60_000) {
			const body = Buffer.from(JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: oauth.refreshToken,
				client_id: ANTHROPIC_CLIENT_ID,
			}));
			const data = await new Promise((resolve, reject) => {
				const req = https.request({
					hostname: "console.anthropic.com",
					path: "/v1/oauth/token",
					method: "POST",
					headers: { "Content-Type": "application/json", "Content-Length": body.length },
				}, (res) => {
					let raw = "";
					res.on("data", c => raw += c);
					res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
				});
				req.on("error", reject);
				req.write(body);
				req.end();
			});
			if (data.access_token) {
				oauth.accessToken = data.access_token;
				oauth.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
				if (data.refresh_token) oauth.refreshToken = data.refresh_token;
				fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
			}
		}
		return oauth.accessToken;
	}

	// Streams one model turn. onEvent receives { type: "delta", text } and
	// { type: "tool_start", name, id, input } as they arrive; resolves with
	// { stopReason, content, usage } once the turn is complete.
	function callClaudeStream(token, messages, onEvent, instructions, signal, baseSystemBlocks) {
		// Re-resolved on every call so a prompt edit on the Configuration page
		// applies to the next model turn without a restart.
		const systemBlocks = (baseSystemBlocks || (promptsConfig ? promptsConfig.classicBlocks() : classicSystemBlocks())).map((b) => ({ ...b }));
		if (instructions && instructions.trim()) {
			systemBlocks.push({ type: "text", text: instructions.trim() });
		}
		systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
		const body = Buffer.from(JSON.stringify({
			model: ANTHROPIC_MODEL,
			max_tokens: 16000,
			system: systemBlocks,
			tools: TOOLS,
			messages: withCachedTail(messages),
			stream: true,
		}));

		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: "api.anthropic.com",
				path: "/v1/messages",
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": "application/json",
					"Content-Length": body.length,
					"anthropic-version": "2023-06-01",
					"anthropic-beta": "oauth-2025-04-20",
					"x-app": "cli",
					"user-agent": "claude-cli/2.1.80 (external, cli)",
				},
				signal,
			}, (res) => {
				// A non-2xx response isn't an SSE stream at all — it's a single
				// plain-JSON error body. Without this check, that body silently
				// fails the `line.startsWith("data: ")` test on every line below
				// and the call resolves as if the model had replied with nothing —
				// hiding real failures (malformed request, invalid conversation,
				// rate limits) behind what looks like an empty-but-successful turn.
				if (res.statusCode && res.statusCode >= 300) {
					let errBody = "";
					res.on("data", (chunk) => { errBody += chunk.toString(); });
					res.on("end", () => {
						let message = `Anthropic API HTTP ${res.statusCode}`;
						try {
							const parsed = JSON.parse(errBody);
							if (parsed?.error?.message) message = parsed.error.message;
						} catch {}
						reject(new Error(message));
					});
					return;
				}

				let buf = "";
				let stopReason = "end_turn";
				const responseContent = [];
				let currentBlock = null;
				let currentText = "";
				let inputJson = "";
				const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

				res.on("data", chunk => {
					buf += chunk.toString();
					const lines = buf.split("\n");
					buf = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						const data = line.slice(6).trim();
						if (data === "[DONE]") continue;
						let ev;
						try { ev = JSON.parse(data); } catch { continue; }

						if (ev.type === "content_block_start") {
							currentBlock = ev.content_block;
							currentText = "";
							inputJson = "";
						}

						if (ev.type === "content_block_delta") {
							if (ev.delta.type === "text_delta") {
								currentText += ev.delta.text;
								onEvent({ type: "delta", text: ev.delta.text });
							}
							if (ev.delta.type === "input_json_delta") {
								inputJson += ev.delta.partial_json;
							}
						}

						if (ev.type === "content_block_stop" && currentBlock) {
							if (currentBlock.type === "text") {
								responseContent.push({ type: "text", text: currentText });
							}
							if (currentBlock.type === "tool_use") {
								let input = {};
								try { input = JSON.parse(inputJson || "{}"); } catch {}
								responseContent.push({ type: "tool_use", id: currentBlock.id, name: currentBlock.name, input });
								onEvent({ type: "tool_start", name: currentBlock.name, id: currentBlock.id, input });
							}
							currentBlock = null;
						}

						if (ev.type === "message_start" && ev.message?.usage) {
							const u = ev.message.usage;
							usage.input_tokens = u.input_tokens || 0;
							usage.cache_creation_input_tokens = u.cache_creation_input_tokens || 0;
							usage.cache_read_input_tokens = u.cache_read_input_tokens || 0;
						}

						if (ev.type === "message_delta") {
							if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
							if (ev.usage?.output_tokens) usage.output_tokens = ev.usage.output_tokens;
						}

						if (ev.type === "error") {
							reject(new Error(ev.error?.message || "Anthropic API error"));
						}
					}
				});

				res.on("end", () => resolve({ stopReason, content: responseContent, usage }));
				res.on("error", reject);
			});

			req.on("error", reject);
			req.write(body);
			req.end();
		});
	}

	return { getOAuthToken, callClaudeStream };
};
