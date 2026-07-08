const http = require("http");
const https = require("https");
const os = require("os");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const db = require("./db");

function isTestSpecPath(fp) {
	return fp && fp.endsWith(".spec.ts") && fp.includes("/tests/") && !fp.includes("/pending/");
}

module.exports = function createAI({ E2E_DIR, TESTS_DIR, DATA_DIR, PENDING_DIR, envLocal }) {
	const ANTHROPIC_CLIENT_ID = envLocal.ANTHROPIC_CLIENT_ID || process.env.ANTHROPIC_CLIENT_ID;
	const ANTHROPIC_MODEL = envLocal.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL;

	const chatRuns = new Map();
	const chatHistories = new Map(); // sessionId -> messages[]

	const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

	async function persistChatLog(log) {
		try {
			await db.chatLog.create({
				data: {
					runId: log.runId,
					startedAt: new Date(log.startedAt),
					endedAt: log.endedAt ? new Date(log.endedAt) : null,
					durationMs: log.durationMs,
					totals: JSON.stringify(log.error ? { ...log.totals, error: log.error } : log.totals),
					apiCalls: JSON.stringify(log.apiCalls),
					messages: JSON.stringify(log.messages || []),
				},
			});
		} catch (err) {
			console.error("[chat-log] Erreur d'enregistrement:", err.message || String(err));
		}
	}

	const TOOLS = [
		{
			name: "Read",
			description: "Read file contents from the filesystem, with line numbers.",
			input_schema: {
				type: "object",
				properties: {
					file_path: { type: "string", description: "Absolute path to file" },
					offset: { type: "number", description: "Line number to start from (1-indexed)" },
					limit: { type: "number", description: "Number of lines to read" },
				},
				required: ["file_path"],
			},
		},
		{
			name: "Write",
			description: "Write content to a file (creates or overwrites).",
			input_schema: {
				type: "object",
				properties: {
					file_path: { type: "string" },
					content: { type: "string" },
				},
				required: ["file_path", "content"],
			},
		},
		{
			name: "Edit",
			description: "Replace a string in a file. Use replace_all to replace all occurrences.",
			input_schema: {
				type: "object",
				properties: {
					file_path: { type: "string" },
					old_string: { type: "string" },
					new_string: { type: "string" },
					replace_all: { type: "boolean" },
				},
				required: ["file_path", "old_string", "new_string"],
			},
		},
		{
			name: "Bash",
			description: "Execute a bash command and return stdout + stderr.",
			input_schema: {
				type: "object",
				properties: {
					command: { type: "string" },
					timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" },
				},
				required: ["command"],
			},
		},
		{
			name: "Glob",
			description: "Find files matching a name pattern (uses find).",
			input_schema: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "File name pattern, e.g. *.ts" },
					path: { type: "string", description: "Directory to search (default: current e2e dir)" },
				},
				required: ["pattern"],
			},
		},
		{
			name: "LS",
			description: "List directory contents.",
			input_schema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory path (default: current e2e dir)" },
				},
				required: [],
			},
		},
		{
			name: "WebFetch",
			description: "Fetch the content of a URL and return it as plain text (HTML tags stripped).",
			input_schema: {
				type: "object",
				properties: {
					url: { type: "string", description: "The URL to fetch" },
					max_length: { type: "number", description: "Max characters to return (default 20000)" },
				},
				required: ["url"],
			},
		},
		{
			name: "ReadImage",
			description: "Read an image file and return it as base64 for visual inspection.",
			input_schema: {
				type: "object",
				properties: {
					file_path: { type: "string", description: "Absolute path to the image file (png, jpg, gif, webp)" },
				},
				required: ["file_path"],
			},
			cache_control: { type: "ephemeral", ttl: "1h" },
		},
	];

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

	const MAX_TOOL_OUTPUT = 10000; // caractères — ajustable selon ton budget token

	const ALLOWED_READ_PATHS = [
		'/home/procertif',
		'/app/data',
	];

	const ALLOWED_WRITE_PATHS = [
		'/home/procertif',
		'/app/data',
	];

	function isPathAllowed(filePath, allowedPaths) {
		const resolved = path.resolve(filePath);
		return allowedPaths.some(allowed => resolved === allowed || resolved.startsWith(allowed + path.sep));
	}

	const ALLOWED_BASH_PATTERNS = [
		/^cat\s+/,
		/^ls(\s|$)/,
		/^npx\s+playwright\s+/,
		/^npm\s+test(\s|$)/,
	];

	function isBashAllowed(command) {
		const trimmed = command.trim();
		if (/[|;&`]|\$\(/.test(trimmed)) return false;
		return ALLOWED_BASH_PATTERNS.some(pattern => pattern.test(trimmed));
	}

	async function executeTool(name, input) {
		const truncate = (str) => {
			if (str.length <= MAX_TOOL_OUTPUT) return str;
			return str.slice(0, MAX_TOOL_OUTPUT) + `\n...[tronqué : ${str.length - MAX_TOOL_OUTPUT} caractères supplémentaires]`;
		};

		try {
			switch (name) {
				case "Read": {
					if (!isPathAllowed(input.file_path, ALLOWED_READ_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					const content = fs.readFileSync(input.file_path, "utf-8");
					const lines = content.split("\n");
					const start = Math.max(0, (input.offset || 1) - 1);
					const end = input.limit != null ? start + input.limit : lines.length;
					const result = lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join("\n");
					return truncate(result);
				}
				case "Write": {
					if (!isPathAllowed(input.file_path, ALLOWED_WRITE_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					if (isTestSpecPath(input.file_path)) {
						const testname = path.basename(input.file_path, ".spec.ts");
						fs.mkdirSync(PENDING_DIR, { recursive: true });
						fs.writeFileSync(path.join(PENDING_DIR, testname + ".spec.ts"), input.content);
						return { _isPending: true, testname, message: `Modifications enregistrées en attente de confirmation (${testname}.spec.ts).` };
					}
					fs.mkdirSync(path.dirname(input.file_path), { recursive: true });
					fs.writeFileSync(input.file_path, input.content);
					return "File written successfully.";
				}
				case "Edit": {
					if (!isPathAllowed(input.file_path, ALLOWED_WRITE_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					if (isTestSpecPath(input.file_path)) {
						const testname = path.basename(input.file_path, ".spec.ts");
						const pendingPath = path.join(PENDING_DIR, testname + ".spec.ts");
						const sourcePath = fs.existsSync(pendingPath) ? pendingPath : input.file_path;
						let content = fs.readFileSync(sourcePath, "utf-8");
						if (!content.includes(input.old_string)) return "Error: old_string not found in file.";
						content = input.replace_all
							? content.split(input.old_string).join(input.new_string)
							: content.replace(input.old_string, input.new_string);
						fs.mkdirSync(PENDING_DIR, { recursive: true });
						fs.writeFileSync(pendingPath, content);
						return { _isPending: true, testname, message: `Modifications enregistrées en attente de confirmation (${testname}.spec.ts).` };
					}
					let content = fs.readFileSync(input.file_path, "utf-8");
					if (!content.includes(input.old_string)) return "Error: old_string not found in file.";
					content = input.replace_all
						? content.split(input.old_string).join(input.new_string)
						: content.replace(input.old_string, input.new_string);
					fs.writeFileSync(input.file_path, content);
					return "Edit applied successfully.";
				}
				case "Bash": {
					if (!isBashAllowed(input.command)) {
						return "Access denied: only cat, ls, npx playwright, and npm test are allowed.";
					}
					// For cat and ls, validate that the path argument is within allowed directories
					const catMatch = input.command.trim().match(/^(?:cat|ls)\s+(.+)/);
					if (catMatch && !isPathAllowed(catMatch[1].trim(), ALLOWED_READ_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					return new Promise((resolve) => {
						exec(
							input.command,
							{ timeout: input.timeout || 30000, maxBuffer: 5 * 1024 * 1024, cwd: E2E_DIR },
							(err, stdout, stderr) => {
								const parts = [];
								if (stdout) parts.push(stdout);
								if (stderr) parts.push("STDERR:\n" + stderr);
								if (err && !stdout && !stderr) parts.push("ERROR: " + err.message);
								resolve(truncate(parts.join("\n").trim() || "(no output)"));
							}
						);
					});
				}
				case "Glob": {
					const globDir = input.path || E2E_DIR;
					if (!isPathAllowed(globDir, ALLOWED_READ_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					return new Promise((resolve) => {
						const pat = input.pattern.replace(/"/g, '\\"');
						exec(`find . -name "${pat}" 2>/dev/null | sort | head -200`, { cwd: globDir, timeout: 10000 },
							(err, stdout) => resolve(truncate(stdout.trim() || "No files found."))
						);
					});
				}
				case "LS": {
					const dir = input.path || E2E_DIR;
					if (!isPathAllowed(dir, ALLOWED_READ_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					const entries = fs.readdirSync(dir, { withFileTypes: true });
					return truncate(entries.map(e => e.isDirectory() ? e.name + "/" : e.name).join("\n") || "(empty)");
				}
				case "WebFetch": {
					return new Promise((resolve) => {
						const maxLen = Math.min(input.max_length || MAX_TOOL_OUTPUT, MAX_TOOL_OUTPUT);
						const lib = input.url.startsWith("https") ? https : http;
						const doRequest = (url, redirects = 0) => {
							if (redirects > 5) return resolve("Error: too many redirects");
							lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
								if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
									return doRequest(res.headers.location, redirects + 1);
								}
								let body = "";
								res.setEncoding("utf-8");
								res.on("data", (chunk) => { if (body.length < maxLen * 2) body += chunk; });
								res.on("end", () => {
									body = body
										.replace(/<script[\s\S]*?<\/script>/gi, "")
										.replace(/<style[\s\S]*?<\/style>/gi, "")
										.replace(/<[^>]+>/g, " ")
										.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
										.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
										.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
									resolve(body.slice(0, maxLen));
								});
								res.on("error", (e) => resolve("Error: " + e.message));
							}).on("error", (e) => resolve("Error: " + e.message));
						};
						doRequest(input.url);
					});
				}
				case "ReadImage": {
					if (!isPathAllowed(input.file_path, ALLOWED_READ_PATHS)) {
						return "Access denied: path outside allowed directories.";
					}
					const ext = path.extname(input.file_path).toLowerCase().slice(1);
					const mediaTypes = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
					const media_type = mediaTypes[ext] || "image/png";
					const data = fs.readFileSync(input.file_path).toString("base64");
					return { _isImage: true, media_type, data };
				}
				default:
					return `Unknown tool: ${name}`;
			}
		} catch (e) {
			return "Error: " + e.message;
		}
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

	async function callClaudeStream(token, messages, onEvent, instructions, signal) {
		const systemBlocks = [
			{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
			{ type: "text", text: `You have access to Read, Write, Edit, Bash, Glob, LS, ReadImage, and WebFetch tools. You have full filesystem access. Always use absolute paths. The e2e test suite is at ${E2E_DIR}. The source code of the tested application (Procertif) is at /app/webapp/.` },
		];
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

	function startChatRun(message, images, sessionId, instructions, environmentId) {
		const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
		const run = { events: [], status: "running", clients: new Set(), abort: null };
		chatRuns.set(runId, run);

		const pushEvent = (event) => {
			const text = JSON.stringify(event);
			run.events.push(text);
			for (const res of run.clients) res.write(`data: ${text}\n\n`);
		};

		const sessionStart = Date.now();
		const log = {
			runId,
			startedAt: new Date(sessionStart).toISOString(),
			endedAt: null,
			durationMs: null,
			apiCalls: [],
				totals: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, apiCalls: 0, toolsCalled: 0 },
			};

		(async () => {
			const history = (sessionId && chatHistories.get(sessionId)) || [];
			const userContent = images && images.length > 0
				? [
					...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
					{ type: "text", text: message || " " },
				]
				: message;
			history.push({ role: "user", content: userContent });

			const token = await getOAuthToken();
			let continueLoop = true;
			let stopped = false;
			const controller = new AbortController();
			run.abort = () => controller.abort();

			try {
				while (continueLoop) {
					const callStart = Date.now();
					const { stopReason, content, usage } = await callClaudeStream(token, history, pushEvent, instructions, controller.signal);
					const callDuration = Date.now() - callStart;

					const toolsCalled = content.filter(b => b.type === "tool_use").map(b => ({ name: b.name, input: b.input }));
					log.apiCalls.push({ index: log.apiCalls.length + 1, startedAt: new Date(callStart).toISOString(), durationMs: callDuration, usage, toolsCalled });
					log.totals.apiCalls++;
					log.totals.toolsCalled += toolsCalled.length;
					for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
						log.totals[k] += usage[k] || 0;
					}

					history.push({ role: "assistant", content });

					if (stopReason === "tool_use") {
						const toolResults = [];
						for (const block of content) {
							if (block.type !== "tool_use") continue;
							const result = await executeTool(block.name, block.input);
							let resultContent;
							if (result?._isImage) {
								resultContent = [{ type: "image", source: { type: "base64", media_type: result.media_type, data: result.data } }];
							} else if (result?._isPending) {
								pushEvent({ type: "pending", testname: result.testname });
								resultContent = result.message;
							} else {
								resultContent = String(result);
							}
							toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultContent });
						}
						if (controller.signal.aborted) {
							continueLoop = false;
							stopped = true;
						} else {
							history.push({ role: "user", content: toolResults });
						}
					} else {
						continueLoop = false;
					}
				}
			} catch (err) {
				if (err.name === "AbortError" || err.code === "ABORT_ERR") {
					stopped = true;
				} else {
					throw err;
				}
			}

			chatHistories.set(runId, history);
			if (chatHistories.size > 50) chatHistories.delete([...chatHistories.keys()][0]);

			const environment = Number.isInteger(environmentId)
				? await db.environment.findUnique({ where: { id: environmentId } })
				: null;

			const actionTestDir = path.join(DATA_DIR, "actionTest");
			for (const msg of history) {
				if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
				for (const block of msg.content) {
					if (block.type !== "tool_use" || !["Write", "Edit"].includes(block.name)) continue;
					const fp = block.input?.file_path || "";
					if (!fp.startsWith(actionTestDir)) continue;
					const testKey = path.basename(fp, ".json");

					// Claude writes this JSON to disk itself (only viable path given its
					// Write/Edit tools). The DB row is what the app actually reads from;
					// the file stays on disk only as a few-shot format reference for Claude.
					try {
						const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"));
						await db.testAction.upsert({
							where: { testname: testKey },
							create: { testname: testKey, file: parsed.file || "", description: parsed.description || "", actionsJson: JSON.stringify(parsed.actions || []), environmentId: environment?.id ?? null, environmentName: environment?.name ?? null },
							update: { file: parsed.file || "", description: parsed.description || "", actionsJson: JSON.stringify(parsed.actions || []), environmentId: environment?.id ?? null, environmentName: environment?.name ?? null },
						});
					} catch {}

					const userMessages = history
						.filter(m => m.role === "user" && !( Array.isArray(m.content) && m.content[0]?.type === "tool_result" ))
						.map(m => ({ role: m.role, content: m.content }));
					await db.testPrompt.upsert({
						where: { testname: testKey },
						create: { testname: testKey, messagesJson: JSON.stringify(userMessages) },
						update: { messagesJson: JSON.stringify(userMessages) },
					});
				}
			}

			log.endedAt = new Date().toISOString();
			log.durationMs = Date.now() - sessionStart;
			log.messages = history.map(msg => ({
				role: msg.role,
				content: Array.isArray(msg.content)
					? msg.content.map(b => {
						if (b.type === "image") return { type: "image", media_type: b.source?.media_type };
						if (b.type === "tool_result" && Array.isArray(b.content)) {
							return { ...b, content: b.content.map(c => c.type === "image" ? { type: "image", media_type: c.source?.media_type } : c) };
						}
						return b;
					})
					: msg.content,
			}));
			await persistChatLog(log);

			run.status = "done";
			pushEvent({ type: "done", status: stopped ? "stopped" : "done", sessionId: runId });
			for (const res of run.clients) res.end();
			run.clients.clear();
			setTimeout(() => chatRuns.delete(runId), 5 * 60 * 1000);
		})().catch(async (err) => {
			chatHistories.set(runId, history);
			if (chatHistories.size > 50) chatHistories.delete([...chatHistories.keys()][0]);
			log.endedAt = new Date().toISOString();
			log.durationMs = Date.now() - sessionStart;
			log.error = err.message;
			await persistChatLog(log);
			run.status = "error";
			pushEvent({ type: "done", status: "error", error: err.message, sessionId: runId });
			for (const res of run.clients) res.end();
			run.clients.clear();
		});

		return runId;
	}

	async function generateSpec(testname) {
		const testFile = path.join(TESTS_DIR, testname + ".spec.ts");

		let testCode = "", actionsText = "";
		try { testCode = fs.readFileSync(testFile, "utf-8"); } catch { return; }
		try {
			const action = await db.testAction.findUnique({ where: { testname } });
			if (action) actionsText = JSON.stringify({ actions: JSON.parse(action.actionsJson) });
		} catch {}

		const prompt = `À partir du code de test Playwright et de la liste d'actions ci-dessous, génère une spécification en français au format Gherkin (Given/When/Then). Utilise les mots-clés français : "Étant donné", "Quand", "Alors", "Et". Décris le scénario du point de vue de l'utilisateur, sans jargon technique, sans sélecteurs CSS, sans mentionner Playwright. Chaque ligne commence par un mot-clé. Sois concis (5 à 8 lignes maximum). Ne mets pas de bloc de code, juste le texte brut.

Règle importante : ne mentionne jamais les interactions physiques avec l'interface (pas de "clique", "remplit", "saisit", "appuie sur", "sélectionne"). Décris uniquement l'intention ou l'action métier de l'utilisateur. Par exemple : au lieu de "Quand il clique sur Commencer", écris "Quand il commence l'évaluation". Au lieu de "Quand il saisit son email", écris "Quand il s'identifie".

Exemple de format attendu :
Étant donné un utilisateur connecté sur la page /mywallet
Quand il ouvre le Cas 1
Alors un quiz démarre dans un nouvel onglet
Et l'utilisateur répond aux 3 questions
Et soumet l'évaluation
Alors une confirmation de soumission s'affiche

## Code du test
\`\`\`typescript
${testCode}
\`\`\`

## Liste des actions
\`\`\`json
${actionsText}
\`\`\``;

		try {
			const token = await getOAuthToken();
			let spec = "";
			await callClaudeStream(token, [{ role: "user", content: prompt }], (event) => {
				if (event.type === "delta" && event.text) spec += event.text;
			});
			if (!spec.trim()) throw new Error("Contenu vide reçu");
			await db.spec.upsert({
				where: { testname },
				create: { testname, content: spec },
				update: { content: spec },
			});
			console.log(`[spec] Généré : ${testname} (${spec.length} chars)`);
		} catch (e) {
			console.error(`[spec] Erreur pour ${testname}:`, e.message || String(e));
		}
	}

	async function generateMissingSpecs() {
		if (!fs.existsSync(TESTS_DIR)) return;
		for (const f of fs.readdirSync(TESTS_DIR).filter(f => f.endsWith(".spec.ts"))) {
			const testname = f.replace(".spec.ts", "");
			const existing = await db.spec.findUnique({ where: { testname } });
			if (!existing) {
				generateSpec(testname).catch(() => {});
			}
		}
	}

	return {
		startChatRun,
		generateSpec,
		generateMissingSpecs,
		getChatRun: (runId) => chatRuns.get(runId),
	};
};
