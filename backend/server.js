const express = require("express");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const ENVIRONMENT_COLORS = require("./environmentColors");

const E2E_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(E2E_DIR, "data");
const SCREENSHOTS_DIR = path.resolve(DATA_DIR, "screenshots");
const TESTS_DIR = path.join(DATA_DIR, "versioned", "tests");
fs.mkdirSync(TESTS_DIR, { recursive: true });
const PENDING_DIR = path.join(DATA_DIR, "pending");

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
	PENDING_DIR,
	envLocal,
});

const { login, requireAuth } = require("./auth")({ envLocal });

async function loadTestEnvironments() {
	const rows = await db.testAction.findMany({ select: { testname: true, environmentId: true, environmentName: true } });
	return Object.fromEntries(rows.map((r) => [r.testname, { environmentId: r.environmentId, environmentName: r.environmentName }]));
}

async function listTests() {
	if (!fs.existsSync(TESTS_DIR)) return [];
	const history = await loadRunHistory();
	const aliases = await loadAliases();
	const testEnvironments = await loadTestEnvironments();
	return fs
		.readdirSync(TESTS_DIR)
		.filter((f) => f.endsWith(".spec.ts"))
		.map((filename) => {
			const testkey = filename.replace(".spec.ts", "");
			const alias = aliases[testkey] || null;
			const env = testEnvironments[testkey] || { environmentId: null, environmentName: null };
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
					environmentId: env.environmentId,
					environmentName: env.environmentName,
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
				environmentId: env.environmentId,
				environmentName: env.environmentName,
			};
		})
		.sort((a, b) => a.filename.localeCompare(b.filename));
}

async function listScreenshots() {
	if (!fs.existsSync(SCREENSHOTS_DIR)) return [];

	// Build a map testkey → display name from the live test list (includes aliases)
	const testDisplayNames = {};
	for (const t of await listTests()) {
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

async function loadGroups() {
	const rows = await db.group.findMany({ orderBy: { createdAt: "asc" } });
	return rows.map((g) => ({ id: g.id, name: g.name, tests: JSON.parse(g.testsJson) }));
}

async function saveGroups(data) {
	const ids = data.map((g) => g.id);
	await db.group.deleteMany({ where: { id: { notIn: ids.length ? ids : ["__none__"] } } });
	for (const g of data) {
		await db.group.upsert({
			where: { id: g.id },
			create: { id: g.id, name: g.name, testsJson: JSON.stringify(g.tests) },
			update: { name: g.name, testsJson: JSON.stringify(g.tests) },
		});
	}
}

async function loadAliases() {
	const rows = await db.testAlias.findMany();
	return Object.fromEntries(rows.map((r) => [r.testkey, r.alias]));
}

async function saveAliases(data) {
	const keys = Object.keys(data);
	await db.testAlias.deleteMany({ where: { testkey: { notIn: keys.length ? keys : ["__none__"] } } });
	for (const k of keys) {
		await db.testAlias.upsert({ where: { testkey: k }, create: { testkey: k, alias: data[k] }, update: { alias: data[k] } });
	}
}

async function loadRunHistory() {
	const rows = await db.runHistory.findMany();
	return Object.fromEntries(rows.map((r) => [r.filename, JSON.parse(r.durationsJson)]));
}

async function recordRunDuration(filename, durationMs) {
	const existing = await db.runHistory.findUnique({ where: { filename } });
	let durations = existing ? JSON.parse(existing.durationsJson) : [];
	durations.push(Math.round(durationMs));
	if (durations.length > 5) durations = durations.slice(-5);
	await db.runHistory.upsert({
		where: { filename },
		create: { filename, durationsJson: JSON.stringify(durations) },
		update: { durationsJson: JSON.stringify(durations) },
	});
}

function estimatedMs(history, filename) {
	const runs = history[filename];
	if (!runs?.length) return null;
	return Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
}

function startRun(filename, baseUrl) {
	const runId =
		Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	const run = { lines: [], status: "running", clients: new Set(), kill: null };
	const startTime = Date.now();
	runs.set(runId, run);

	try { execSync('pkill -9 -f "playwright"'); } catch {}
	try { execSync('pkill -9 -f "chrome"'); } catch {}

	const proc = spawn(
		"node_modules/.bin/playwright",
		["test", `data/versioned/tests/${filename}`, "--reporter=line,./step-reporter.cjs", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
		{
			cwd: E2E_DIR,
			env: { ...process.env, ...envLocal, ...(baseUrl ? { BASE_URL: baseUrl } : {}) },
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

	proc.on("close", async (code) => {
		clearTimeout(autoKillTimer);
		run.status = code === 0 ? "passed" : "failed";
		if (code === 0) await recordRunDuration(filename, Date.now() - startTime);
		const newEstimatedMs = estimatedMs(await loadRunHistory(), filename);
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

api.get("/screenshots", async (req, res) => {
	res.json(await listScreenshots());
});

api.get("/tests", async (req, res) => {
	res.json(await listTests());
});

api.get("/test-aliases", async (req, res) => {
	res.json(await loadAliases());
});

api.put("/test-aliases/:testkey", async (req, res) => {
	try {
		const aliases = await loadAliases();
		const alias = (req.body.alias || "").trim();
		if (alias) {
			aliases[req.params.testkey] = alias;
		} else {
			delete aliases[req.params.testkey];
		}
		await saveAliases(aliases);
		res.json({ ok: true });
	} catch {
		res.status(400).send("Bad request");
	}
});

api.delete("/test-aliases/:testkey", async (req, res) => {
	const aliases = await loadAliases();
	delete aliases[req.params.testkey];
	await saveAliases(aliases);
	res.sendStatus(204);
});

api.delete("/tests/:testkey", async (req, res) => {
	const testkey = req.params.testkey;
	const filename = testkey + ".spec.ts";
	try { fs.unlinkSync(path.join(TESTS_DIR, filename)); } catch {}
	const screenshotFolder = path.join(SCREENSHOTS_DIR, testkey);
	if (fs.existsSync(screenshotFolder)) {
		fs.rmSync(screenshotFolder, { recursive: true, force: true });
	}
	try { fs.unlinkSync(path.join(PENDING_DIR, testkey + ".spec.ts")); } catch {}
	await db.spec.deleteMany({ where: { testname: testkey } });
	await db.testAction.deleteMany({ where: { testname: testkey } });
	await db.testPrompt.deleteMany({ where: { testname: testkey } });
	const grps = await loadGroups();
	const grpsUpdated = grps.map(g => ({ ...g, tests: g.tests.filter(t => t !== filename) }));
	await saveGroups(grpsUpdated);
	await db.runHistory.deleteMany({ where: { filename } });
	const aliases = await loadAliases();
	if (aliases[testkey]) { delete aliases[testkey]; await saveAliases(aliases); }
	res.sendStatus(204);
});

api.get("/groups", async (req, res) => {
	res.json(await loadGroups());
});

api.post("/session", async (req, res) => {
	try {
		const all = Array.isArray(req.body.all) ? req.body.all : [];
		const failed = Array.isArray(req.body.failed) ? req.body.failed : [];
		await db.session.upsert({
			where: { id: 1 },
			create: { id: 1, allJson: JSON.stringify(all), failedJson: JSON.stringify(failed) },
			update: { allJson: JSON.stringify(all), failedJson: JSON.stringify(failed) },
		});
		res.sendStatus(204);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.get("/session", async (req, res) => {
	const session = await db.session.findUnique({ where: { id: 1 } });
	if (!session) {
		res.status(404).send("No session");
		return;
	}
	res.json({ all: JSON.parse(session.allJson), failed: JSON.parse(session.failedJson) });
});

api.post("/groups", async (req, res) => {
	try {
		const name = (req.body.name || "").trim();
		if (!name) { res.status(400).send("Name required"); return; }
		const grps = await loadGroups();
		const newGroup = {
			id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
			name,
			tests: [],
		};
		grps.push(newGroup);
		await saveGroups(grps);
		res.status(201).json(newGroup);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.put("/groups/:id", async (req, res) => {
	try {
		const grps = await loadGroups();
		const grp = grps.find((g) => g.id === req.params.id);
		if (!grp) { res.status(404).send("Not found"); return; }
		if (req.body.name !== undefined) grp.name = String(req.body.name).trim();
		if (Array.isArray(req.body.tests)) {
			grp.tests = req.body.tests;
		}
		await saveGroups(grps);
		res.json(grp);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.delete("/groups/:id", async (req, res) => {
	const grps = await loadGroups();
	const idx = grps.findIndex((g) => g.id === req.params.id);
	if (idx === -1) { res.status(404).send("Not found"); return; }
	grps.splice(idx, 1);
	await saveGroups(grps);
	res.sendStatus(204);
});

api.get("/environment-colors", (req, res) => {
	res.json(ENVIRONMENT_COLORS);
});

api.get("/environments", async (req, res) => {
	const environments = await db.environment.findMany({ orderBy: { createdAt: "asc" } });
	res.json(environments);
});

api.post("/environments", async (req, res) => {
	const name = (req.body.name || "").trim();
	const url = (req.body.url || "").trim();
	const comment = (req.body.comment || "").trim();
	const color = req.body.color;
	if (!name || !url) { res.status(400).send("Name and url required"); return; }
	if (!ENVIRONMENT_COLORS.includes(color)) { res.status(400).send("Invalid color"); return; }
	try {
		const environment = await db.environment.create({ data: { name, url, comment: comment || null, color } });
		res.status(201).json(environment);
	} catch {
		res.status(400).send("Bad request");
	}
});

api.put("/environments/:id", async (req, res) => {
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
	const data = {};
	if (req.body.name !== undefined) {
		const name = String(req.body.name).trim();
		if (!name) { res.status(400).send("Name required"); return; }
		data.name = name;
	}
	if (req.body.url !== undefined) {
		const url = String(req.body.url).trim();
		if (!url) { res.status(400).send("Url required"); return; }
		data.url = url;
	}
	if (req.body.comment !== undefined) {
		data.comment = String(req.body.comment).trim() || null;
	}
	if (req.body.color !== undefined) {
		if (!ENVIRONMENT_COLORS.includes(req.body.color)) { res.status(400).send("Invalid color"); return; }
		data.color = req.body.color;
	}
	try {
		const environment = await db.environment.update({ where: { id }, data });
		res.json(environment);
	} catch {
		res.status(404).send("Not found");
	}
});

api.delete("/environments/:id", async (req, res) => {
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) { res.status(400).send("Invalid id"); return; }
	await db.environment.deleteMany({ where: { id } });
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
	const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
	const runId = startRun(filename, baseUrl || undefined);
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

api.get("/spec/:testname", async (req, res) => {
	const spec = await db.spec.findUnique({ where: { testname: req.params.testname } });
	if (!spec) {
		res.status(404).json({});
		return;
	}
	res.json({ spec: spec.content });
});

api.get("/actions/:testKey", async (req, res) => {
	const action = await db.testAction.findUnique({ where: { testname: req.params.testKey } });
	if (!action) {
		res.status(404).send("Not found");
		return;
	}
	res.json({ test: action.testname, file: action.file, description: action.description, actions: JSON.parse(action.actionsJson) });
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
		const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
		const proc = spawn(
			"npx",
			["playwright", "test", `data/versioned/tests/${tempName}.spec.ts`, "--reporter=list,./step-reporter.cjs", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
			{ cwd: E2E_DIR, env: { ...process.env, ...envLocal, ...(baseUrl ? { BASE_URL: baseUrl } : {}) }, detached: true }
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

api.get("/prompt/:testKey", async (req, res) => {
	const prompt = await db.testPrompt.findUnique({ where: { testname: req.params.testKey } });
	if (!prompt) {
		res.status(404).send("Not found");
		return;
	}
	res.json(JSON.parse(prompt.messagesJson));
});

api.get("/chat-logs", async (req, res) => {
	try {
		const logs = await db.chatLog.findMany({
			orderBy: { startedAt: "desc" },
			select: { id: true, startedAt: true, endedAt: true, durationMs: true, totals: true, messages: true },
		});
		const summaries = logs.map((log) => {
			let messageCount = 0;
			try {
				const messages = JSON.parse(log.messages);
				messageCount = Array.isArray(messages) ? messages.filter((m) => m.role === "user").length : 0;
			} catch {}
			let totals = null;
			try { totals = log.totals ? JSON.parse(log.totals) : null; } catch {}
			return { id: log.id, startedAt: log.startedAt, endedAt: log.endedAt, durationMs: log.durationMs, totals, messageCount };
		});
		res.json(summaries);
	} catch (err) {
		res.status(500).send(err.message);
	}
});

api.get("/chat-logs/:id", async (req, res) => {
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) {
		res.status(400).send("Invalid id");
		return;
	}
	const log = await db.chatLog.findUnique({ where: { id } });
	if (!log) {
		res.status(404).send("Not found");
		return;
	}
	res.json({
		runId: log.runId,
		startedAt: log.startedAt,
		endedAt: log.endedAt,
		durationMs: log.durationMs,
		totals: log.totals ? JSON.parse(log.totals) : null,
		apiCalls: log.apiCalls ? JSON.parse(log.apiCalls) : [],
		messages: JSON.parse(log.messages),
	});
});

api.delete("/chat-logs/:id", async (req, res) => {
	const id = Number(req.params.id);
	if (!Number.isInteger(id)) {
		res.status(400).send("Invalid id");
		return;
	}
	await db.chatLog.deleteMany({ where: { id } });
	res.sendStatus(204);
});

api.post("/chat", (req, res) => {
	try {
		const { message, images, sessionId, instructions, environmentId, environmentName, environmentUrl, environmentComment } = req.body;
		const hasImages = Array.isArray(images) && images.length > 0;
		if (!hasImages && (!message || typeof message !== "string" || !message.trim())) {
			res.status(400).send("Message required");
			return;
		}
		const envId = Number(environmentId);
		if (!Number.isInteger(envId)) {
			res.status(400).send("environmentId required");
			return;
		}
		let envContext = `This test is being generated for the environment "${environmentName || ""}" (${(environmentUrl || "").trim()}).`;
		if (typeof environmentComment === "string" && environmentComment.trim()) {
			envContext += ` Environment notes: ${environmentComment.trim()}. If these notes contain values needed to execute the test (OTP codes, credentials, feature flags, etc.), hardcode them literally in the generated Playwright script — this test is written specifically for this environment.`;
		}
		const mergedInstructions = [envContext, instructions].filter(Boolean).join("\n\n") || null;
		const runId = startChatRun((message || "").trim(), hasImages ? images : null, sessionId || null, mergedInstructions, envId);
		res.json({ runId });
	} catch {
		res.status(400).send("Bad request");
	}
});

api.post("/chat-save", async (req, res) => {
	try {
		const { filename, messages } = req.body;
		if (!filename || !Array.isArray(messages)) {
			res.status(400).send("Invalid payload");
			return;
		}
		const safe = path.basename(filename).replace(/[^a-zA-Z0-9_\-.]/g, '_');
		await db.savedChat.upsert({
			where: { filename: safe },
			create: { filename: safe, messagesJson: JSON.stringify(messages) },
			update: { messagesJson: JSON.stringify(messages) },
		});
		res.json({ ok: true, filename: safe });
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
	generateMissingSpecs().catch(() => {});
});

// Reap zombie children re-parented from Chromium/Playwright.
// When Node.js reaps any direct child, libuv calls waitpid(-1, WNOHANG) in a
// loop, which picks up ALL pending zombies — including re-adopted ones.
setInterval(() => {
	const p = spawn("true", [], { stdio: "ignore" });
	p.on("error", () => {});
	p.on("close", () => {});
}, 5000);
