const express = require("express");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const E2E_DIR = path.resolve(__dirname, "..");
const TESTS_DIR = path.resolve(E2E_DIR, "tests");
fs.mkdirSync(TESTS_DIR, { recursive: true });
const SCREENSHOTS_DIR = path.resolve(E2E_DIR, "screenshots");
const DATA_DIR = path.resolve(E2E_DIR, "data");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const ALIASES_FILE = path.join(DATA_DIR, "test-aliases.json");
const SESSION_FILE = path.join(DATA_DIR, "last-session.json");
const RUN_HISTORY_FILE = path.join(DATA_DIR, "run-history.json");
const SPECS_DIR = path.join(DATA_DIR, "specs");
const PENDING_DIR = path.join(DATA_DIR, "pending");
const CHAT_LOGS_DIR = path.join(DATA_DIR, "chat-logs");

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

const runs = new Map();

const { startChatRun, generateSpec, generateMissingSpecs, getChatRun } = require("./ia")({
	E2E_DIR,
	TESTS_DIR,
	DATA_DIR,
	SPECS_DIR,
	PENDING_DIR,
	CHAT_LOGS_DIR,
	envLocal,
});

const { login, requireAuth } = require("./auth")({ envLocal });

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
		clearTimeout(autoKillTimer);
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

const specDebounce = new Map();
fs.watch(TESTS_DIR, (eventType, filename) => {
	if (!filename || !filename.endsWith(".spec.ts")) return;
	const testname = filename.replace(".spec.ts", "");
	clearTimeout(specDebounce.get(testname));
	specDebounce.set(testname, setTimeout(() => {
		generateSpec(testname).catch(() => {});
	}, 2000));
});

const app = express();

app.use((req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (req.method === "OPTIONS") {
		res.sendStatus(204);
		return;
	}
	next();
});

app.use(express.json({ limit: "25mb" }));

app.post("/login", login);

// --- Public assets used by the frontend before/without auth ---

app.get("/i18n/:lang(en|fr).json", (req, res) => {
	const langFile = path.join(__dirname, "i18n", req.params.lang + ".json");
	if (!fs.existsSync(langFile)) { res.sendStatus(404); return; }
	res.type("json").send(fs.readFileSync(langFile, "utf-8"));
});
app.get("/api/lang", (req, res) => {
	const lang = (envLocal.LANG || process.env.LANG || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
	res.json({ lang });
});
app.get("/screenshots-img/*", (req, res) => {
	const imgPath = path.join(SCREENSHOTS_DIR, req.params[0]);
	if (!imgPath.startsWith(SCREENSHOTS_DIR) || !fs.existsSync(imgPath)) {
		res.sendStatus(404);
		return;
	}
	res.type("png").send(fs.readFileSync(imgPath));
});

// --- Protected API ---

const api = express.Router();
app.use("/api", requireAuth, api);

api.get("/screenshots", (req, res) => {
	res.json(listScreenshots());
});

api.get("/tests", (req, res) => {
	res.json(listTests());
});

api.get("/test-aliases", (req, res) => {
	res.json(loadAliases());
});

api.put("/test-aliases/:testkey", (req, res) => {
	try {
		const aliases = loadAliases();
		const alias = (req.body.alias || "").trim();
		if (alias) {
			aliases[req.params.testkey] = alias;
		} else {
			delete aliases[req.params.testkey];
		}
		saveAliases(aliases);
		res.json({ ok: true });
	} catch {
		res.status(400).send("Bad request");
	}
});

api.delete("/test-aliases/:testkey", (req, res) => {
	const aliases = loadAliases();
	delete aliases[req.params.testkey];
	saveAliases(aliases);
	res.sendStatus(204);
});

api.delete("/tests/:testkey", (req, res) => {
	const testkey = req.params.testkey;
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
	res.sendStatus(204);
});

api.get("/groups", (req, res) => {
	res.json(loadGroups());
});

api.post("/session", (req, res) => {
	try {
		fs.writeFileSync(SESSION_FILE, JSON.stringify(req.body, null, 2));
		res.sendStatus(204);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.get("/session", (req, res) => {
	try {
		const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
		res.json(data);
	} catch {
		res.status(404).send("No session");
	}
});

api.post("/groups", (req, res) => {
	try {
		const name = (req.body.name || "").trim();
		if (!name) { res.status(400).send("Name required"); return; }
		const grps = loadGroups();
		const newGroup = {
			id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
			name,
			tests: [],
		};
		grps.push(newGroup);
		saveGroups(grps);
		res.status(201).json(newGroup);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.put("/groups/:id", (req, res) => {
	try {
		const grps = loadGroups();
		const grp = grps.find((g) => g.id === req.params.id);
		if (!grp) { res.status(404).send("Not found"); return; }
		if (req.body.name !== undefined) grp.name = String(req.body.name).trim();
		if (Array.isArray(req.body.tests)) {
			grp.tests = req.body.tests;
		}
		saveGroups(grps);
		res.json(grp);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.delete("/groups/:id", (req, res) => {
	const grps = loadGroups();
	const idx = grps.findIndex((g) => g.id === req.params.id);
	if (idx === -1) { res.status(404).send("Not found"); return; }
	grps.splice(idx, 1);
	saveGroups(grps);
	res.sendStatus(204);
});

api.get("/screenshots/:folder", (req, res) => {
	const folderPath = path.join(SCREENSHOTS_DIR, req.params.folder);
	if (!folderPath.startsWith(SCREENSHOTS_DIR + path.sep)) {
		res.status(400).send("Invalid folder");
		return;
	}
	let count = 0;
	if (fs.existsSync(folderPath)) {
		count = fs.readdirSync(folderPath).filter(f => f.endsWith(".png")).length;
	}
	res.json({ count });
});

api.delete("/screenshots/:folder", (req, res) => {
	const folderPath = path.join(SCREENSHOTS_DIR, req.params.folder);
	if (!folderPath.startsWith(SCREENSHOTS_DIR + path.sep) && folderPath !== SCREENSHOTS_DIR) {
		res.status(400).send("Invalid folder");
		return;
	}
	if (fs.existsSync(folderPath)) {
		fs.rmSync(folderPath, { recursive: true, force: true });
	}
	res.sendStatus(204);
});

api.post("/run/:filename", (req, res) => {
	const filename = req.params.filename;
	if (
		!filename.endsWith(".spec.ts") ||
		path.basename(filename) !== filename ||
		!fs.existsSync(path.join(TESTS_DIR, filename))
	) {
		res.status(400).send("Invalid test file");
		return;
	}
	const runId = startRun(filename);
	res.json({ runId });
});

api.post("/kill/:runId", (req, res) => {
	const run = runs.get(req.params.runId);
	if (!run || typeof run.kill !== "function") {
		res.status(404).send("Not found");
		return;
	}
	run.kill();
	res.json({ ok: true });
});

api.get("/run-status/:runId", (req, res) => {
	const run = runs.get(req.params.runId);
	if (!run) { res.sendStatus(404); return; }
	res.json({ status: run.status });
});

api.get("/stream/:runId", (req, res) => {
	const run = runs.get(req.params.runId);
	if (!run) { res.sendStatus(404); return; }
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	for (const text of run.lines) {
		res.write(`data: ${JSON.stringify({ text })}\n\n`);
	}
	if (run.status !== "running") {
		res.write(`data: ${JSON.stringify({ done: true, status: run.status })}\n\n`);
		res.end();
		return;
	}
	run.clients.add(res);
	req.on("close", () => run.clients.delete(res));
});

api.post("/spec-regen/:testname", (req, res) => {
	generateSpec(req.params.testname).catch(() => {});
	res.sendStatus(202);
});

api.get("/spec/:testname", (req, res) => {
	const specFile = path.join(SPECS_DIR, req.params.testname + ".md");
	if (!path.resolve(specFile).startsWith(SPECS_DIR) || !fs.existsSync(specFile)) {
		res.status(404).json({});
		return;
	}
	res.json({ spec: fs.readFileSync(specFile, "utf-8") });
});

api.get("/actions/:testKey", (req, res) => {
	const jsonPath = path.join(DATA_DIR, "actionTest", `${req.params.testKey}.json`);
	if (!jsonPath.startsWith(path.join(DATA_DIR, "actionTest")) || !fs.existsSync(jsonPath)) {
		res.status(404).send("Not found");
		return;
	}
	res.type("json").send(fs.readFileSync(jsonPath, "utf-8"));
});

api.get("/pending", (req, res) => {
	fs.mkdirSync(PENDING_DIR, { recursive: true });
	const files = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith(".spec.ts"));
	res.json(files.map(f => f.replace(".spec.ts", "")));
});

api.all("/pending/:testname/:action(run|confirm|discard)", (req, res) => {
	const { testname, action } = req.params;
	const pendingFile = path.join(PENDING_DIR, testname + ".spec.ts");
	if (!fs.existsSync(pendingFile)) { res.status(404).send("Not found"); return; }

	if (action === "confirm") {
		fs.copyFileSync(pendingFile, path.join(TESTS_DIR, testname + ".spec.ts"));
		fs.unlinkSync(pendingFile);
		res.json({ ok: true });
		return;
	}
	if (action === "discard") {
		fs.unlinkSync(pendingFile);
		res.json({ ok: true });
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
		res.json({ runId });
	}
});

api.get("/prompt/:testKey", (req, res) => {
	const jsonPath = path.join(DATA_DIR, "promptTest", `${req.params.testKey}.json`);
	if (!jsonPath.startsWith(path.join(DATA_DIR, "promptTest")) || !fs.existsSync(jsonPath)) {
		res.status(404).send("Not found");
		return;
	}
	res.type("json").send(fs.readFileSync(jsonPath, "utf-8"));
});

api.get("/config", (req, res) => {
	res.json(parseEnvFile(path.join(E2E_DIR, ".env")));
});

api.post("/config", (req, res) => {
	try {
		const data = req.body;
		const lines = Object.entries(data)
			.filter(([k]) => k.trim())
			.map(([k, v]) => `${k.trim()}=${v}`);
		fs.writeFileSync(path.join(E2E_DIR, ".env"), lines.join("\n") + "\n", "utf-8");
		Object.keys(envLocal).forEach(k => delete envLocal[k]);
		Object.assign(envLocal, data);
		res.json({ ok: true });
	} catch {
		res.status(400).send("Bad request");
	}
});

api.get("/chat-logs", (req, res) => {
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
		res.json(summaries);
	} catch (err) {
		res.status(500).send(err.message);
	}
});

api.get("/chat-logs/:filename", (req, res) => {
	const filename = path.basename(req.params.filename);
	const logPath = path.join(CHAT_LOGS_DIR, filename);
	if (!logPath.startsWith(CHAT_LOGS_DIR) || !fs.existsSync(logPath)) {
		res.status(404).send("Not found");
		return;
	}
	res.type("json").send(fs.readFileSync(logPath, "utf-8"));
});

api.delete("/chat-logs/:filename", (req, res) => {
	const filename = path.basename(req.params.filename);
	const logPath = path.join(CHAT_LOGS_DIR, filename);
	if (!logPath.startsWith(CHAT_LOGS_DIR)) {
		res.status(400).send("Invalid filename");
		return;
	}
	if (fs.existsSync(logPath)) {
		fs.unlinkSync(logPath);
	}
	res.sendStatus(204);
});

api.post("/chat", (req, res) => {
	try {
		const { message, images, sessionId, instructions } = req.body;
		const hasImages = Array.isArray(images) && images.length > 0;
		if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
			res.status(400).send("Message required");
			return;
		}
		const runId = startChatRun((message || "").trim(), hasImages ? images : null, sessionId || null, instructions || null);
		res.json({ runId });
	} catch {
		res.status(400).send("Bad request");
	}
});

api.post("/chat-save", (req, res) => {
	try {
		const { filename, messages } = req.body;
		if (!filename || !Array.isArray(messages)) {
			res.status(400).send("Invalid payload");
			return;
		}
		const safe = path.basename(filename).replace(/[^a-zA-Z0-9_\-.]/g, '_');
		const dest = path.join(E2E_DIR, "tests", "prompt", safe);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, JSON.stringify(messages, null, 2), "utf8");
		res.json({ path: dest });
	} catch (err) {
		res.status(500).send(err.message);
	}
});

api.post("/chat-stop/:runId", (req, res) => {
	const run = getChatRun(req.params.runId);
	if (!run || typeof run.abort !== "function") {
		res.status(404).send("Not found");
		return;
	}
	run.abort();
	res.json({ ok: true });
});

api.get("/chat-stream/:runId", (req, res) => {
	const run = getChatRun(req.params.runId);
	if (!run) { res.sendStatus(404); return; }
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
});

// --- React SPA (built by frontend/) ---

const FRONTEND_DIST = path.join(E2E_DIR, "frontend", "dist");
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api).*/, (req, res) => {
	res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

app.use((req, res) => {
	res.status(404).send("Not found");
});

app.use((err, req, res, next) => {
	res.status(400).json({ error: "Bad request" });
});

app.listen(PORT, () => {
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
