const http = require("http");
const https = require("https");
const os = require("os");
const { spawn, exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const E2E_DIR = path.resolve(__dirname, "..");
const TESTS_DIR = path.resolve(E2E_DIR, "tests");
const SCREENSHOTS_DIR = path.resolve(E2E_DIR, "screenshots");
const DATA_DIR = path.resolve(E2E_DIR, "data");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const ALIASES_FILE = path.join(DATA_DIR, "test-aliases.json");
const SESSION_FILE = path.join(DATA_DIR, "last-session.json");
const RUN_HISTORY_FILE = path.join(DATA_DIR, "run-history.json");
const SPECS_DIR = path.join(DATA_DIR, "specs");
const PENDING_DIR = path.join(DATA_DIR, "pending");
const CHAT_LOGS_DIR = path.join(DATA_DIR, "chat-logs");

function isTestSpecPath(fp) {
	return fp && fp.endsWith(".spec.ts") && fp.includes("/tests/") && !fp.includes("/pending/");
}

function parseEnvFile(filePath) {
	try {
		return Object.fromEntries(
			fs.readFileSync(filePath, "utf-8")
				.split("\n")
				.filter((l) => l && !l.startsWith("#") && l.includes("="))
				.map((l) => {
					const idx = l.indexOf("=");
					return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
				}),
		);
	} catch {
		return {};
	}
}

const envLocal = parseEnvFile(path.join(E2E_DIR, ".env"));

const PORT = Number(envLocal.PORT || process.env.PORT || 3333);
const ANTHROPIC_CLIENT_ID = envLocal.ANTHROPIC_CLIENT_ID || process.env.ANTHROPIC_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_MODEL = envLocal.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";


const runs = new Map();
const chatRuns = new Map();
const chatHistories = new Map(); // sessionId -> messages[]

const CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

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

// Constante à ajouter en haut du fichier, près des autres constantes
const MAX_TOOL_OUTPUT = 10000; // caractères — ajustable selon ton budget token

const ALLOWED_READ_PATHS = [
	'/home/procertif',
	'/app/screenshots',
	'/app/tests',
	'/app/data',
	'/app/test-results',
];

const ALLOWED_WRITE_PATHS = [
	'/home/procertif',
	'/app/tests',
	'/app/data',
	'/app/test-results',
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
					// Réduit à MAX_TOOL_OUTPUT au lieu de 20000 fixe
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
		messages,
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

function startChatRun(message, images, sessionId, instructions) {
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

		const actionTestDir = path.join(DATA_DIR, "actionTest");
		const promptTestDir = path.join(DATA_DIR, "promptTest");
		for (const msg of history) {
			if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block.type !== "tool_use" || !["Write", "Edit"].includes(block.name)) continue;
				const fp = block.input?.file_path || "";
				if (!fp.startsWith(actionTestDir)) continue;
				const testKey = path.basename(fp, ".json");
				fs.mkdirSync(promptTestDir, { recursive: true });
				const userMessages = history
					.filter(m => m.role === "user" && !( Array.isArray(m.content) && m.content[0]?.type === "tool_result" ))
					.map(m => ({ role: m.role, content: m.content }));
				fs.writeFileSync(
					path.join(promptTestDir, testKey + ".json"),
					JSON.stringify(userMessages, null, 2),
					"utf-8"
				);
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
		try {
			fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });
			const ts = new Date(sessionStart).toISOString().replace(/[:.]/g, "-").slice(0, 19);
			fs.writeFileSync(path.join(CHAT_LOGS_DIR, `${ts}_${runId}.json`), JSON.stringify(log, null, 2), "utf-8");
		} catch {}

		run.status = "done";
		pushEvent({ type: "done", status: stopped ? "stopped" : "done", sessionId: runId });
		for (const res of run.clients) res.end();
		run.clients.clear();
		setTimeout(() => chatRuns.delete(runId), 5 * 60 * 1000);
	})().catch((err) => {
		chatHistories.set(runId, history);
		if (chatHistories.size > 50) chatHistories.delete([...chatHistories.keys()][0]);
		log.endedAt = new Date().toISOString();
		log.durationMs = Date.now() - sessionStart;
		log.error = err.message;
		try {
			fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });
			const ts = new Date(sessionStart).toISOString().replace(/[:.]/g, "-").slice(0, 19);
			fs.writeFileSync(path.join(CHAT_LOGS_DIR, `${ts}_${runId}.json`), JSON.stringify(log, null, 2), "utf-8");
		} catch {}
		run.status = "error";
		pushEvent({ type: "done", status: "error", error: err.message, sessionId: runId });
		for (const res of run.clients) res.end();
		run.clients.clear();
	});

	return runId;
}

function listTests() {
	if (!fs.existsSync(TESTS_DIR)) return [];
	const history = loadRunHistory();
	const aliases = loadAliases();
	return fs
		.readdirSync(TESTS_DIR)
		.filter((f) => f.endsWith(".spec.ts"))
		.map((filename) => {
			const testkey = filename.replace(".spec.ts", "");
			const alias = aliases[testkey] || null;
			const m = testkey.match(/^(?:\d+-)?cas(\d+)-(.+?)(?:-(?:ai|noai))?$/);
			if (m) {
				const [, casNum, type] = m;
				const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
				return {
					filename,
					cas: `cas${casNum}`,
					casNum: parseInt(casNum),
					type,
					typeLabel,
					name: `Cas ${casNum} - ${typeLabel}`,
					alias,
					estimatedMs: estimatedMs(history, filename),
				};
			}
			return {
				filename,
				cas: testkey,
				casNum: 0,
				type: testkey,
				typeLabel: testkey,
				name: testkey.replace(/-/g, " "),
				alias,
				estimatedMs: estimatedMs(history, filename),
			};
		})
		.sort((a, b) => a.filename.localeCompare(b.filename));
}

function listScreenshots() {
	if (!fs.existsSync(SCREENSHOTS_DIR)) return [];

	// Build a map testkey → display name from the live test list (includes aliases)
	const testDisplayNames = {};
	for (const t of listTests()) {
		testDisplayNames[t.filename.replace(".spec.ts", "")] = t.alias || t.name;
	}

	const groups = [];
	for (const folder of fs.readdirSync(SCREENSHOTS_DIR).sort()) {
		const folderPath = path.join(SCREENSHOTS_DIR, folder);
		if (!fs.statSync(folderPath).isDirectory()) continue;

		let testName;
		if (testDisplayNames[folder]) {
			// Known test — use the exact same name (alias or auto-generated) as the test list
			testName = testDisplayNames[folder];
		} else {
			// Orphaned screenshot folder (test deleted or manually created)
			const m = folder.match(/^cas(\d+)-(.+?)(?:-(ai|noai))?$/);
			if (m) {
				const typeLabel = m[2].charAt(0).toUpperCase() + m[2].slice(1);
				testName = `Cas ${m[1]} - ${typeLabel}`;
			} else {
				testName = folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			}
		}

		const screenshots = fs.readdirSync(folderPath)
			.filter(f => f.endsWith(".png"))
			.sort((a, b) => {
				const na = parseInt(a) || 0;
				const nb = parseInt(b) || 0;
				return na !== nb ? na - nb : a.localeCompare(b);
			})
			.map(png => ({
				url: `/screenshots-img/${encodeURIComponent(folder)}/${encodeURIComponent(png)}`,
				file: png.replace(/\.png$/, ""),
			}));

		groups.push({ folder, testName, screenshots });
	}
	return groups;
}

function loadGroups() {
	try {
		return JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
	} catch {
		return [];
	}
}

function saveGroups(data) {
	fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2));
}

function loadAliases() {
	try { return JSON.parse(fs.readFileSync(ALIASES_FILE, "utf-8")); } catch { return {}; }
}

function saveAliases(data) {
	fs.writeFileSync(ALIASES_FILE, JSON.stringify(data, null, 2));
}

function loadRunHistory() {
	try { return JSON.parse(fs.readFileSync(RUN_HISTORY_FILE, "utf-8")); } catch { return {}; }
}

function recordRunDuration(filename, durationMs) {
	const history = loadRunHistory();
	if (!history[filename]) history[filename] = [];
	history[filename].push(Math.round(durationMs));
	if (history[filename].length > 5) history[filename] = history[filename].slice(-5);
	fs.writeFileSync(RUN_HISTORY_FILE, JSON.stringify(history, null, 2));
}

function estimatedMs(history, filename) {
	const runs = history[filename];
	if (!runs?.length) return null;
	return Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			try { resolve(body ? JSON.parse(body) : {}); }
			catch { reject(new Error("Invalid JSON")); }
		});
		req.on("error", reject);
	});
}

function startRun(filename) {
	const runId =
		Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	const run = { lines: [], status: "running", clients: new Set(), kill: null };
	const startTime = Date.now();
	runs.set(runId, run);

	try { execSync('pkill -9 -f "playwright"'); } catch {}
	try { execSync('pkill -9 -f "chrome"'); } catch {}

	const proc = spawn(
		"node_modules/.bin/playwright",
		["test", `tests/${filename}`, "--reporter=line", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
		{
			cwd: E2E_DIR,
			env: { ...process.env, ...envLocal },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	run.kill = () => {
		try { proc.kill("SIGKILL"); } catch {}
		try { execSync('pkill -9 -f "playwright"'); } catch {}
		try { execSync('pkill -9 -f "chrome"'); } catch {}
	};

	const autoKillTimer = setTimeout(() => {
		if (run.status === "running") run.kill();
	}, 300_000);

	const logFile = path.join(DATA_DIR, `run-${filename.replace(".spec.ts", "")}-last.log`);
	let logData = "";

	const push = (data) => {
		const text = data.toString();
		logData += text;
		run.lines.push(text);
		for (const res of run.clients) {
			res.write(`data: ${JSON.stringify({ text })}\n\n`);
		}
	};

	proc.stdout.on("data", push);
	proc.stderr.on("data", push);

	proc.on("close", (code) => {
		clearTimeout(autoKillTimer);
		logData += `\n[EXIT CODE: ${code}]\n`;
		run.status = code === 0 ? "passed" : "failed";
		if (code === 0) recordRunDuration(filename, Date.now() - startTime);
		const newEstimatedMs = estimatedMs(loadRunHistory(), filename);
		const msg = `data: ${JSON.stringify({ done: true, status: run.status, estimatedMs: newEstimatedMs })}\n\n`;
		for (const res of run.clients) {
			res.write(msg);
			res.end();
		}
		run.clients.clear();
	});

	return runId;
}

async function generateSpec(testname) {
	const specFile = path.join(SPECS_DIR, testname + ".md");
	const testFile = path.join(TESTS_DIR, testname + ".spec.ts");
	const actionsFile = path.join(DATA_DIR, "actionTest", testname + ".json");

	let testCode = "", actionsText = "";
	try { testCode = fs.readFileSync(testFile, "utf-8"); } catch { return; }
	try { actionsText = fs.readFileSync(actionsFile, "utf-8"); } catch {}

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
		fs.mkdirSync(SPECS_DIR, { recursive: true });
		fs.writeFileSync(specFile, spec, "utf-8");
		console.log(`[spec] Généré : ${testname} (${spec.length} chars)`);
	} catch (e) {
		console.error(`[spec] Erreur pour ${testname}:`, e.message || String(e));
		try { fs.unlinkSync(specFile); } catch {}
	}
}

function generateMissingSpecs() {
	fs.mkdirSync(SPECS_DIR, { recursive: true });
	if (!fs.existsSync(TESTS_DIR)) return;
	for (const f of fs.readdirSync(TESTS_DIR).filter(f => f.endsWith(".spec.ts"))) {
		const testname = f.replace(".spec.ts", "");
		if (!fs.existsSync(path.join(SPECS_DIR, testname + ".md"))) {
			generateSpec(testname).catch(() => {});
		}
	}
}

const specDebounce = new Map();
fs.watch(TESTS_DIR, (eventType, filename) => {
	if (!filename || !filename.endsWith(".spec.ts")) return;
	const testname = filename.replace(".spec.ts", "");
	clearTimeout(specDebounce.get(testname));
	specDebounce.set(testname, setTimeout(() => {
		generateSpec(testname).catch(() => {});
	}, 2000));
});

http
	.createServer(async (req, res) => {
		const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (
			req.method === "GET" &&
			(pathname === "/" || pathname === "/index.html")
		) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "index.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/index.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "index.css")));
			return;
		}

		if (req.method === "GET" && pathname === "/screenshots.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "screenshots.css")));
			return;
		}

		if (req.method === "GET" && pathname === "/logo.png") {
			try {
				res.writeHead(200, { "Content-Type": "image/png" });
				res.end(fs.readFileSync(path.join(__dirname, "logo.png")));
			} catch {
				res.writeHead(404);
				res.end();
			}
			return;
		}

		if (req.method === "GET" && pathname === "/screenshots") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "screenshots.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/groups") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "groups.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/groups.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "groups.css")));
			return;
		}

		if (req.method === "GET" && pathname === "/api/screenshots") {
			const screenshots = listScreenshots();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(screenshots));
			return;
		}

		const imgMatch = pathname.match(/^\/screenshots-img\/(.+)$/);
		if (req.method === "GET" && imgMatch) {
			const imgPath = path.join(SCREENSHOTS_DIR, decodeURIComponent(imgMatch[1]));
			if (!imgPath.startsWith(SCREENSHOTS_DIR) || !fs.existsSync(imgPath)) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, { "Content-Type": "image/png" });
			res.end(fs.readFileSync(imgPath));
			return;
		}

		if (req.method === "GET" && pathname === "/api/tests") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(listTests()));
			return;
		}

		if (req.method === "GET" && pathname === "/api/test-aliases") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(loadAliases()));
			return;
		}

		const testAliasMatch = pathname.match(/^\/api\/test-aliases\/([^/]+)$/);
		if (testAliasMatch) {
			const testkey = decodeURIComponent(testAliasMatch[1]);
			if (req.method === "PUT") {
				try {
					const body = await readBody(req);
					const aliases = loadAliases();
					const alias = (body.alias || "").trim();
					if (alias) {
						aliases[testkey] = alias;
					} else {
						delete aliases[testkey];
					}
					saveAliases(aliases);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true }));
				} catch {
					res.writeHead(400); res.end("Bad request");
				}
				return;
			}
			if (req.method === "DELETE") {
				const aliases = loadAliases();
				delete aliases[testkey];
				saveAliases(aliases);
				res.writeHead(204); res.end();
				return;
			}
		}

		const testDeleteMatch = pathname.match(/^\/api\/tests\/([^/]+)$/);
		if (req.method === "DELETE" && testDeleteMatch) {
			const testkey = decodeURIComponent(testDeleteMatch[1]);
			const filename = testkey + ".spec.ts";
			try { fs.unlinkSync(path.join(TESTS_DIR, filename)); } catch {}
			const screenshotFolder = path.join(SCREENSHOTS_DIR, testkey);
			if (fs.existsSync(screenshotFolder)) {
				fs.rmSync(screenshotFolder, { recursive: true, force: true });
			}
			for (const p of [
				path.join(DATA_DIR, "actionTest", testkey + ".json"),
				path.join(SPECS_DIR, testkey + ".md"),
				path.join(DATA_DIR, "promptTest", testkey + ".json"),
				path.join(PENDING_DIR, testkey + ".spec.ts"),
				path.join(DATA_DIR, `run-${testkey}-last.log`),
				path.join(DATA_DIR, `run-${testkey}-last-failed.log`),
			]) { try { fs.unlinkSync(p); } catch {} }
			const grps = loadGroups();
			const grpsUpdated = grps.map(g => ({ ...g, tests: g.tests.filter(t => t !== filename) }));
			saveGroups(grpsUpdated);
			const history = loadRunHistory();
			if (history[filename]) {
				delete history[filename];
				fs.writeFileSync(RUN_HISTORY_FILE, JSON.stringify(history, null, 2));
			}
			const aliases = loadAliases();
			if (aliases[testkey]) { delete aliases[testkey]; saveAliases(aliases); }
			res.writeHead(204); res.end();
			return;
		}

		if (req.method === "GET" && pathname === "/api/groups") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(loadGroups()));
			return;
		}

		if (req.method === "POST" && pathname === "/api/session") {
			try {
				const body = await readBody(req);
				fs.writeFileSync(SESSION_FILE, JSON.stringify(body, null, 2));
				res.writeHead(204);
				res.end();
			} catch {
				res.writeHead(400);
				res.end("Bad request");
			}
			return;
		}

		if (req.method === "GET" && pathname === "/api/session") {
			try {
				const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(data));
			} catch {
				res.writeHead(404);
				res.end("No session");
			}
			return;
		}

		if (req.method === "POST" && pathname === "/api/groups") {
			try {
				const body = await readBody(req);
				const name = (body.name || "").trim();
				if (!name) { res.writeHead(400); res.end("Name required"); return; }
				const grps = loadGroups();
				const newGroup = {
					id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
					name,
					tests: [],
				};
				grps.push(newGroup);
				saveGroups(grps);
				res.writeHead(201, { "Content-Type": "application/json" });
				res.end(JSON.stringify(newGroup));
			} catch {
				res.writeHead(400);
				res.end("Bad request");
			}
			return;
		}

		const groupIdMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
		if (groupIdMatch) {
			const id = decodeURIComponent(groupIdMatch[1]);
			if (req.method === "PUT") {
				try {
					const body = await readBody(req);
					const grps = loadGroups();
					const grp = grps.find((g) => g.id === id);
					if (!grp) { res.writeHead(404); res.end("Not found"); return; }
					if (body.name !== undefined) grp.name = String(body.name).trim();
					if (Array.isArray(body.tests)) {
						grp.tests = body.tests;
					}
					saveGroups(grps);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(grp));
				} catch {
					res.writeHead(400);
					res.end("Bad request");
				}
				return;
			}
			if (req.method === "DELETE") {
				const grps = loadGroups();
				const idx = grps.findIndex((g) => g.id === id);
				if (idx === -1) { res.writeHead(404); res.end("Not found"); return; }
				grps.splice(idx, 1);
				saveGroups(grps);
				res.writeHead(204);
				res.end();
				return;
			}
		}

		const screenshotDeleteMatch = pathname.match(/^\/api\/screenshots\/([^/]+)$/);
		if (req.method === "GET" && screenshotDeleteMatch) {
			const folder = decodeURIComponent(screenshotDeleteMatch[1]);
			const folderPath = path.join(SCREENSHOTS_DIR, folder);
			if (!folderPath.startsWith(SCREENSHOTS_DIR + path.sep)) {
				res.writeHead(400); res.end("Invalid folder"); return;
			}
			let count = 0;
			if (fs.existsSync(folderPath)) {
				count = fs.readdirSync(folderPath).filter(f => f.endsWith(".png")).length;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ count }));
			return;
		}
		if (req.method === "DELETE" && screenshotDeleteMatch) {
			const folder = decodeURIComponent(screenshotDeleteMatch[1]);
			const folderPath = path.join(SCREENSHOTS_DIR, folder);
			if (!folderPath.startsWith(SCREENSHOTS_DIR + path.sep) && folderPath !== SCREENSHOTS_DIR) {
				res.writeHead(400);
				res.end("Invalid folder");
				return;
			}
			if (fs.existsSync(folderPath)) {
				fs.rmSync(folderPath, { recursive: true, force: true });
			}
			res.writeHead(204);
			res.end();
			return;
		}

		const runMatch = pathname.match(/^\/api\/run\/(.+)$/);
		if (req.method === "POST" && runMatch) {
			const filename = decodeURIComponent(runMatch[1]);
			if (
				!filename.endsWith(".spec.ts") ||
				path.basename(filename) !== filename ||
				!fs.existsSync(path.join(TESTS_DIR, filename))
			) {
				res.writeHead(400);
				res.end("Invalid test file");
				return;
			}
			const runId = startRun(filename);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ runId }));
			return;
		}

		const killMatch = pathname.match(/^\/api\/kill\/(.+)$/);
		if (req.method === "POST" && killMatch) {
			const run = runs.get(killMatch[1]);
			if (!run || typeof run.kill !== "function") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			run.kill();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		const runStatusMatch = pathname.match(/^\/api\/run-status\/(.+)$/);
		if (req.method === "GET" && runStatusMatch) {
			const run = runs.get(runStatusMatch[1]);
			if (!run) { res.writeHead(404); res.end(); return; }
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: run.status }));
			return;
		}

		const streamMatch = pathname.match(/^\/api\/stream\/(.+)$/);
		if (req.method === "GET" && streamMatch) {
			const run = runs.get(streamMatch[1]);
			if (!run) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			for (const text of run.lines) {
				res.write(`data: ${JSON.stringify({ text })}\n\n`);
			}
			if (run.status !== "running") {
				res.write(
					`data: ${JSON.stringify({ done: true, status: run.status })}\n\n`,
				);
				res.end();
				return;
			}
			run.clients.add(res);
			req.on("close", () => run.clients.delete(res));
			return;
		}

		if (req.method === "GET" && pathname === "/scenarios") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "scenarios.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/scenarios.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "scenarios.css")));
			return;
		}

		const specRegenMatch = pathname.match(/^\/api\/spec-regen\/([^/]+)$/);
		if (req.method === "POST" && specRegenMatch) {
			const testname = decodeURIComponent(specRegenMatch[1]);
			generateSpec(testname).catch(() => {});
			res.writeHead(202); res.end();
			return;
		}

		const specMatch = pathname.match(/^\/api\/spec\/([^/]+)$/);
		if (req.method === "GET" && specMatch) {
			const testname = decodeURIComponent(specMatch[1]);
			const specFile = path.join(SPECS_DIR, testname + ".md");
			if (!path.resolve(specFile).startsWith(SPECS_DIR) || !fs.existsSync(specFile)) {
				res.writeHead(404); res.end("{}");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ spec: fs.readFileSync(specFile, "utf-8") }));
			return;
		}

		const actionsMatch = pathname.match(/^\/api\/actions\/([^/]+)$/);
		if (req.method === "GET" && actionsMatch) {
			const testKey = decodeURIComponent(actionsMatch[1]);
			const jsonPath = path.join(DATA_DIR, "actionTest", `${testKey}.json`);
			if (!jsonPath.startsWith(path.join(DATA_DIR, "actionTest")) || !fs.existsSync(jsonPath)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(fs.readFileSync(jsonPath, "utf-8"));
			return;
		}

		if (req.method === "GET" && pathname === "/api/pending") {
			fs.mkdirSync(PENDING_DIR, { recursive: true });
			const files = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith(".spec.ts"));
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(files.map(f => f.replace(".spec.ts", ""))));
			return;
		}

		const pendingActionMatch = pathname.match(/^\/api\/pending\/([^/]+)\/(run|confirm|discard)$/);
		if (pendingActionMatch) {
			const testname = decodeURIComponent(pendingActionMatch[1]);
			const action = pendingActionMatch[2];
			const pendingFile = path.join(PENDING_DIR, testname + ".spec.ts");
			if (!fs.existsSync(pendingFile)) { res.writeHead(404); res.end("Not found"); return; }

			if (action === "confirm") {
				fs.copyFileSync(pendingFile, path.join(TESTS_DIR, testname + ".spec.ts"));
				fs.unlinkSync(pendingFile);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			if (action === "discard") {
				fs.unlinkSync(pendingFile);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			if (action === "run") {
				const tempName = `_pending_${testname}`;
				const tempFile = path.join(TESTS_DIR, tempName + ".spec.ts");
				fs.copyFileSync(pendingFile, tempFile);
				const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
				const run = { lines: [], status: "running", clients: new Set(), kill: null };
				runs.set(runId, run);
				const proc = spawn(
					"npx",
					["playwright", "test", `tests/${tempName}.spec.ts`, "--reporter=list", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
					{ cwd: E2E_DIR, env: { ...process.env, ...envLocal }, detached: true }
				);
				run.kill = () => {
					try { process.kill(-proc.pid, "SIGKILL"); } catch {}
					try { execSync('pkill -9 -f "playwright"'); } catch {}
					try { execSync('pkill -9 -f "chrome"'); } catch {}
				};
				const autoKillTimer = setTimeout(() => {
					if (run.status === "running") run.kill();
				}, 300_000);
				const push = (data) => {
					const text = data.toString();
					run.lines.push(text);
					for (const res of run.clients) res.write(`data: ${JSON.stringify({ text })}\n\n`);
				};
				proc.stdout.on("data", push);
				proc.stderr.on("data", push);
				proc.on("close", (code) => {
					clearTimeout(autoKillTimer);
					try { fs.unlinkSync(tempFile); } catch {}
					run.status = code === 0 ? "passed" : "failed";
					const msg = `data: ${JSON.stringify({ done: true, status: run.status })}\n\n`;
					for (const c of run.clients) { c.write(msg); c.end(); }
					run.clients.clear();
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ runId }));
				return;
			}
		}

		const promptMatch = pathname.match(/^\/api\/prompt\/([^/]+)$/);
		if (req.method === "GET" && promptMatch) {
			const testKey = decodeURIComponent(promptMatch[1]);
			const jsonPath = path.join(DATA_DIR, "promptTest", `${testKey}.json`);
			if (!jsonPath.startsWith(path.join(DATA_DIR, "promptTest")) || !fs.existsSync(jsonPath)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(fs.readFileSync(jsonPath, "utf-8"));
			return;
		}

		if (req.method === "GET" && pathname === "/chat") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "chat.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/logs") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "logs.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/config") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "config.html")));
			return;
		}

		if (req.method === "GET" && pathname === "/api/config") {
			const env = parseEnvFile(path.join(E2E_DIR, ".env"));
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(env));
			return;
		}

		if (req.method === "GET" && pathname === "/api/lang") {
			const lang = (envLocal.LANG || process.env.LANG || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ lang }));
			return;
		}

		const i18nMatch = pathname.match(/^\/i18n\/(en|fr)\.json$/);
		if (req.method === "GET" && i18nMatch) {
			const langFile = path.join(__dirname, "i18n", i18nMatch[1] + ".json");
			if (!fs.existsSync(langFile)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(fs.readFileSync(langFile, "utf-8"));
			return;
		}

		if (req.method === "GET" && pathname === "/i18n.js") {
			res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "i18n.js"), "utf-8"));
			return;
		}

		if (req.method === "POST" && pathname === "/api/config") {
			readBody(req).then((data) => {
				const lines = Object.entries(data)
					.filter(([k]) => k.trim())
					.map(([k, v]) => `${k.trim()}=${v}`);
				fs.writeFileSync(path.join(E2E_DIR, ".env"), lines.join("\n") + "\n", "utf-8");
				Object.keys(envLocal).forEach(k => delete envLocal[k]);
				Object.assign(envLocal, data);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			}).catch(() => {
				res.writeHead(400);
				res.end("Bad request");
			});
			return;
		}

		if (req.method === "GET" && pathname === "/logs.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "logs.css")));
			return;
		}

		if (req.method === "GET" && pathname === "/api/chat-logs") {
			try {
				fs.mkdirSync(CHAT_LOGS_DIR, { recursive: true });
				const files = fs.readdirSync(CHAT_LOGS_DIR)
					.filter(f => f.endsWith(".json"))
					.sort()
					.reverse();
				const summaries = files.map(f => {
					try {
						const log = JSON.parse(fs.readFileSync(path.join(CHAT_LOGS_DIR, f), "utf-8"));
						return {
							filename: f,
							startedAt: log.startedAt,
							endedAt: log.endedAt,
							durationMs: log.durationMs,
							totals: log.totals,
							messageCount: Array.isArray(log.messages) ? log.messages.filter(m => m.role === "user").length : 0,
						};
					} catch {
						return { filename: f, startedAt: null, totals: null };
					}
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(summaries));
			} catch (err) {
				res.writeHead(500);
				res.end(err.message);
			}
			return;
		}

		const chatLogMatch = pathname.match(/^\/api\/chat-logs\/([^/]+)$/);
		if (req.method === "GET" && chatLogMatch) {
			const filename = path.basename(decodeURIComponent(chatLogMatch[1]));
			const logPath = path.join(CHAT_LOGS_DIR, filename);
			if (!logPath.startsWith(CHAT_LOGS_DIR) || !fs.existsSync(logPath)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(fs.readFileSync(logPath, "utf-8"));
			return;
		}

		if (req.method === "DELETE" && chatLogMatch) {
			const filename = path.basename(decodeURIComponent(chatLogMatch[1]));
			const logPath = path.join(CHAT_LOGS_DIR, filename);
			if (!logPath.startsWith(CHAT_LOGS_DIR)) {
				res.writeHead(400);
				res.end("Invalid filename");
				return;
			}
			if (fs.existsSync(logPath)) {
				fs.unlinkSync(logPath);
			}
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method === "GET" && pathname === "/chat.css") {
			res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "chat.css")));
			return;
		}

		if (req.method === "POST" && pathname === "/api/chat") {
			try {
				const body = await readBody(req);
				const { message, images, sessionId, instructions } = body;
				const hasImages = Array.isArray(images) && images.length > 0;
				if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
					res.writeHead(400);
					res.end("Message required");
					return;
				}
				const runId = startChatRun((message || "").trim(), hasImages ? images : null, sessionId || null, instructions || null);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ runId }));
			} catch {
				res.writeHead(400);
				res.end("Bad request");
			}
			return;
		}

		if (req.method === "POST" && pathname === "/api/chat-save") {
			try {
				const body = await readBody(req);
				const { filename, messages } = body;
				if (!filename || !Array.isArray(messages)) {
					res.writeHead(400);
					res.end("Invalid payload");
					return;
				}
				const safe = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
				const dest = path.join(E2E_DIR, "tests", "prompt", safe);
				fs.mkdirSync(path.dirname(dest), { recursive: true });
				fs.writeFileSync(dest, JSON.stringify(messages, null, 2), "utf8");
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ path: dest }));
			} catch (err) {
				res.writeHead(500);
				res.end(err.message);
			}
			return;
		}

		const chatStopMatch = pathname.match(/^\/api\/chat-stop\/(.+)$/);
		if (req.method === "POST" && chatStopMatch) {
			const run = chatRuns.get(chatStopMatch[1]);
			if (!run || typeof run.abort !== "function") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			run.abort();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		const chatStreamMatch = pathname.match(/^\/api\/chat-stream\/(.+)$/);
		if (req.method === "GET" && chatStreamMatch) {
			const run = chatRuns.get(chatStreamMatch[1]);
			if (!run) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			for (const event of run.events) {
				res.write(`data: ${event}\n\n`);
			}
			if (run.status !== "running") {
				res.end();
				return;
			}
			run.clients.add(res);
			req.on("close", () => run.clients.delete(res));
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	})
	.listen(PORT, () => {
		console.log(`Test runner available at http://localhost:${PORT}`);
		generateMissingSpecs();
	});

// Reap zombie children re-parented from Chromium/Playwright.
// When Node.js reaps any direct child, libuv calls waitpid(-1, WNOHANG) in a
// loop, which picks up ALL pending zombies — including re-adopted ones.
setInterval(() => {
	const p = spawn("true", [], { stdio: "ignore" });
	p.on("error", () => {});
	p.on("close", () => {});
}, 5000);
