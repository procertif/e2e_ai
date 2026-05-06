const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 3333;
const E2E_DIR = path.resolve(__dirname, "..");
const TESTS_DIR = path.resolve(E2E_DIR, "tests");
const SCREENSHOTS_DIR = path.resolve(E2E_DIR, "screenshots");
const GROUPS_FILE = path.join(__dirname, "groups.json");
const SESSION_FILE = path.join(__dirname, "last-session.json");

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
const OPENAI_API_KEY = envLocal.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";

const WWW_DIR = "/home/procertif/www";

const runs = new Map();
const chatRuns = new Map();
const chatSessions = new Map(); // runId -> CLI session_id string

function startChatRun(message, sessionId) {
	const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	const run = { events: [], status: "running", clients: new Set() };
	chatRuns.set(runId, run);

	const pushEvent = (event) => {
		const text = JSON.stringify(event);
		run.events.push(text);
		for (const res of run.clients) res.write(`data: ${text}\n\n`);
	};

	(async () => {
		const args = [
			"--print",
			"--output-format", "stream-json",
			"--verbose",
			"--include-partial-messages",
			"--dangerously-skip-permissions",
		];

		// Resume previous CLI session if one exists
		const cliSessionId = sessionId && chatSessions.get(sessionId);
		if (cliSessionId) {
			chatSessions.delete(sessionId);
			args.push("--resume", cliSessionId);
		}

		const proc = spawn("claude", args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
			cwd: E2E_DIR,
		});

		proc.stdin.write(message);
		proc.stdin.end();
		proc.stderr.resume(); // drain to prevent blocking

		let buf = "";
		let newCliSessionId = null;

		proc.stdout.on("data", (chunk) => {
			buf += chunk.toString();
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) parseLine(line);
		});

		proc.stdout.on("close", () => {
			if (buf.trim()) parseLine(buf.trim());
		});

		function parseLine(line) {
			if (!line.trim()) return;
			try {
				const e = JSON.parse(line);

				if (e.type === "stream_event") {
					const ev = e.event;
					if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
						pushEvent({ type: "delta", text: ev.delta.text });
					}
					if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
						pushEvent({ type: "tool_start", name: ev.content_block.name });
					}
				}

				if (e.type === "result") {
					newCliSessionId = e.session_id || null;
				}
			} catch { /* skip malformed lines */ }
		}

		await new Promise((resolve, reject) => {
			proc.on("close", (code) => (code === 0 || code === null ? resolve() : reject(new Error(`CLI exit ${code}`))));
			proc.on("error", reject);
		});

		// Store CLI session ID so next message can resume
		if (newCliSessionId) chatSessions.set(runId, newCliSessionId);

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
	runs.set(runId, run);

	const proc = spawn(
		"npx",
		["playwright", "test", `tests/${filename}`, "--reporter=line", "--project=chromium", "--headed"],
		{
			cwd: E2E_DIR,
			env: { ...process.env, OPENAI_API_KEY, OPEN_AI_KEY: OPENAI_API_KEY },
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

			const msg = `data: ${JSON.stringify({ done: true, status: run.status })}\n\n`;
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
						for (const g of grps) {
							if (g.id !== id) g.tests = g.tests.filter((t) => !body.tests.includes(t));
						}
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
				const { message, sessionId } = body;
				if (!message || typeof message !== "string" || !message.trim()) {
					res.writeHead(400);
					res.end("Message required");
					return;
				}
				const runId = startChatRun(message.trim(), sessionId || null);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ runId }));
			} catch {
				res.writeHead(400);
				res.end("Bad request");
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
