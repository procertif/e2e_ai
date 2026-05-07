const http = require("http");
const https = require("https");
const os = require("os");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const E2E_DIR = path.resolve(__dirname, "..");
const TESTS_DIR = path.resolve(E2E_DIR, "tests");
const SCREENSHOTS_DIR = path.resolve(E2E_DIR, "screenshots");
const DATA_DIR = path.resolve(E2E_DIR, "data");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const SESSION_FILE = path.join(DATA_DIR, "last-session.json");
const RUN_HISTORY_FILE = path.join(DATA_DIR, "run-history.json");

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

async function executeTool(name, input) {
	try {
		switch (name) {
			case "Read": {
				const content = fs.readFileSync(input.file_path, "utf-8");
				const lines = content.split("\n");
				const start = Math.max(0, (input.offset || 1) - 1);
				const end = input.limit != null ? start + input.limit : lines.length;
				return lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join("\n");
			}
			case "Write": {
				fs.mkdirSync(path.dirname(input.file_path), { recursive: true });
				fs.writeFileSync(input.file_path, input.content);
				return "File written successfully.";
			}
			case "Edit": {
				let content = fs.readFileSync(input.file_path, "utf-8");
				if (!content.includes(input.old_string)) return "Error: old_string not found in file.";
				content = input.replace_all
					? content.split(input.old_string).join(input.new_string)
					: content.replace(input.old_string, input.new_string);
				fs.writeFileSync(input.file_path, content);
				return "Edit applied successfully.";
			}
			case "Bash": {
				return new Promise((resolve) => {
					exec(
						input.command,
						{ timeout: input.timeout || 30000, maxBuffer: 5 * 1024 * 1024, cwd: E2E_DIR },
						(err, stdout, stderr) => {
							const parts = [];
							if (stdout) parts.push(stdout);
							if (stderr) parts.push("STDERR:\n" + stderr);
							if (err && !stdout && !stderr) parts.push("ERROR: " + err.message);
							resolve(parts.join("\n").trim() || "(no output)");
						}
					);
				});
			}
			case "Glob": {
				return new Promise((resolve) => {
					const cwd = input.path || E2E_DIR;
					const pat = input.pattern.replace(/"/g, '\\"');
					exec(`find . -name "${pat}" 2>/dev/null | sort | head -200`, { cwd, timeout: 10000 },
						(err, stdout) => resolve(stdout.trim() || "No files found.")
					);
				});
			}
			case "LS": {
				const dir = input.path || E2E_DIR;
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				return entries.map(e => e.isDirectory() ? e.name + "/" : e.name).join("\n") || "(empty)";
			}
			case "WebFetch": {
				return new Promise((resolve) => {
					const maxLen = input.max_length || 20000;
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

async function callClaudeStream(token, messages, onEvent, instructions) {
	const systemBlocks = [
		{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
		{ type: "text", text: `You have access to Read, Write, Edit, Bash, Glob, LS, ReadImage, and WebFetch tools. You have full filesystem access. Always use absolute paths. The e2e test suite is at ${E2E_DIR}.` },
	];
	if (instructions && instructions.trim()) {
		systemBlocks.push({ type: "text", text: instructions.trim() });
	}
	const body = Buffer.from(JSON.stringify({
		model: ANTHROPIC_MODEL,
		max_tokens: 8096,
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
		}, (res) => {
			let buf = "";
			let stopReason = "end_turn";
			const responseContent = [];
			let currentBlock = null;
			let currentText = "";
			let inputJson = "";

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

					if (ev.type === "message_delta" && ev.delta?.stop_reason) {
						stopReason = ev.delta.stop_reason;
					}

					if (ev.type === "error") {
						reject(new Error(ev.error?.message || "Anthropic API error"));
					}
				}
			});

			res.on("end", () => resolve({ stopReason, content: responseContent }));
			res.on("error", reject);
		});

		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

function startChatRun(message, images, sessionId, instructions) {
	const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	const run = { events: [], status: "running", clients: new Set() };
	chatRuns.set(runId, run);

	const pushEvent = (event) => {
		const text = JSON.stringify(event);
		run.events.push(text);
		for (const res of run.clients) res.write(`data: ${text}\n\n`);
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

		while (continueLoop) {
			const { stopReason, content } = await callClaudeStream(token, history, pushEvent, instructions);
			history.push({ role: "assistant", content });

			if (stopReason === "tool_use") {
				const toolResults = [];
				for (const block of content) {
					if (block.type !== "tool_use") continue;
					const result = await executeTool(block.name, block.input);
					const toolResult = result?._isImage
						? { type: "tool_result", tool_use_id: block.id, content: [{ type: "image", source: { type: "base64", media_type: result.media_type, data: result.data } }] }
						: { type: "tool_result", tool_use_id: block.id, content: String(result) };
					toolResults.push(toolResult);
				}
				history.push({ role: "user", content: toolResults });
			} else {
				continueLoop = false;
			}
		}

		chatHistories.set(runId, history);
		if (chatHistories.size > 50) chatHistories.delete([...chatHistories.keys()][0]);

		run.status = "done";
		pushEvent({ type: "done", status: "done", sessionId: runId });
		for (const res of run.clients) res.end();
		run.clients.clear();
		setTimeout(() => chatRuns.delete(runId), 5 * 60 * 1000);
	})().catch((err) => {
		run.status = "error";
		pushEvent({ type: "done", status: "error", error: err.message });
		for (const res of run.clients) res.end();
		run.clients.clear();
	});

	return runId;
}

function listTests() {
	if (!fs.existsSync(TESTS_DIR)) return [];
	const history = loadRunHistory();
	return fs
		.readdirSync(TESTS_DIR)
		.filter((f) => f.endsWith(".spec.ts"))
		.map((filename) => {
			const m = filename
				.replace(".spec.ts", "")
				.match(/^(\d+)-(cas(\d+))-(.+?)-(ai|noai)$/);
			if (m) {
				const [, order, cas, casNum, type, mode] = m;
				const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
				return {
					filename,
					cas,
					order: parseInt(order),
					casNum: parseInt(casNum),
					type,
					typeLabel,
					mode,
					name: `Cas ${casNum} - ${typeLabel}`,
					estimatedMs: estimatedMs(history, filename),
				};
			}
			const baseName = filename.replace(".spec.ts", "");
			return {
				filename,
				cas: baseName,
				order: 0,
				casNum: 0,
				type: baseName,
				typeLabel: baseName,
				mode: "noai",
				name: baseName.replace(/-/g, " "),
				estimatedMs: estimatedMs(history, filename),
			};
		})
		.sort((a, b) => a.order - b.order || a.filename.localeCompare(b.filename));
}

function listScreenshots() {
	if (!fs.existsSync(SCREENSHOTS_DIR)) return [];

	const groups = [];
	for (const folder of fs.readdirSync(SCREENSHOTS_DIR).sort()) {
		const folderPath = path.join(SCREENSHOTS_DIR, folder);
		if (!fs.statSync(folderPath).isDirectory()) continue;

		const m = folder.match(/^cas(\d+)-(.+?)(?:-(ai|noai))?$/);
		let testName;
		if (m) {
			const typeLabel = m[2].charAt(0).toUpperCase() + m[2].slice(1);
			testName = `Cas ${m[1]} - ${typeLabel}`;
		} else {
			testName = folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
	const run = { lines: [], status: "running", clients: new Set() };
	const startTime = Date.now();
	runs.set(runId, run);

	const proc = spawn(
		"npx",
		["playwright", "test", `tests/${filename}`, "--reporter=line", "--project=chromium", "--headed"],
		{
			cwd: E2E_DIR,
			env: { ...process.env, ...envLocal },
		},
	);

	const push = (data) => {
		const text = data.toString();
		run.lines.push(text);
		for (const res of run.clients) {
			res.write(`data: ${JSON.stringify({ text })}\n\n`);
		}
	};

	proc.stdout.on("data", push);
	proc.stderr.on("data", push);

	proc.on("close", (code) => {
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

		if (req.method === "GET" && pathname === "/chat") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(fs.readFileSync(path.join(__dirname, "chat.html")));
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
	.listen(PORT, () =>
		console.log(`Test runner available at http://localhost:${PORT}`),
	);
