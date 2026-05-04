const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 3333;
const E2E_DIR = path.resolve(__dirname, "..");
const SCREENSHOTS_DIR = path.resolve(E2E_DIR, "screenshots");

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

const runs = new Map();

function listTests() {
	return fs
		.readdirSync(E2E_DIR)
		.filter((f) => /^\d+-cas\d+-.+-(ai|noai)\.spec\.ts$/.test(f))
		.map((filename) => {
			const m = filename
				.replace(".spec.ts", "")
				.match(/^(\d+)-(cas(\d+))-(.+?)-(ai|noai)$/);
			if (!m) return null;
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
		})
		.filter(Boolean)
		.sort((a, b) => a.order - b.order || a.type.localeCompare(b.type));
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

function startRun(filename) {
	const runId =
		Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	const run = { lines: [], status: "running", clients: new Set() };
	runs.set(runId, run);

	const proc = spawn(
		"npx",
		["playwright", "test", filename, "--reporter=line", "--project=chromium", "--headed"],
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
	.createServer((req, res) => {
		const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

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
				!/^\d+-cas\d+-.+-(ai|noai)\.spec\.ts$/.test(filename) ||
				!fs.existsSync(path.join(E2E_DIR, filename))
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

		res.writeHead(404);
		res.end("Not found");
	})
	.listen(PORT, () =>
		console.log(`Test runner available at http://localhost:${PORT}`),
	);
