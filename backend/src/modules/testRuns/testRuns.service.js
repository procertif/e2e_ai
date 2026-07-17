const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { newId } = require("../../core/ids");
const { envVarsToJson } = require("../../core/envVars");

const RUN_TIMEOUT_MS = 300_000;

// Owns every Playwright process launched from the UI (Tests page + pending
// preview) — one shared in-memory map of runs, each buffering its console
// lines so SSE clients can connect late and replay from the start.
module.exports = function createTestRunsService({ paths, envLocal, testRunner, testsService, testMeta }) {
	const { E2E_DIR, TESTS_DIR, PENDING_DIR } = paths;
	const runs = new Map();

	function killStrayBrowsers() {
		try { execSync('pkill -9 -f "playwright"'); } catch {}
		try { execSync('pkill -9 -f "chrome"'); } catch {}
	}

	function createRun() {
		const runId = newId();
		const run = { lines: [], status: "running", clients: new Set(), kill: null };
		runs.set(runId, run);
		return { runId, run };
	}

	function forwardOutput(run) {
		return (data) => {
			const text = data.toString();
			run.lines.push(text);
			for (const res of run.clients) {
				res.write(`data: ${JSON.stringify({ text })}\n\n`);
			}
		};
	}

	function autoKillAfterTimeout(run) {
		return setTimeout(() => {
			if (run.status === "running") run.kill();
		}, RUN_TIMEOUT_MS);
	}

	// Runs a confirmed test. The spawned process gets a minimal environment —
	// deliberately NOT spreading process.env/envLocal: a test spec has no
	// legitimate reason to see this app's own backend secrets (AUTH_TOKEN,
	// JWT_PRIVATE_KEY, GitHub/Anthropic credentials), and runs as the
	// restricted e2erunner account whenever one is configured, so it can't
	// read them off disk either.
	function startTestRun(filename, baseUrl, environment) {
		const envVars = environment?.variables;
		const { runId, run } = createRun();
		const startTime = Date.now();

		killStrayBrowsers();

		const proc = spawn(
			"node_modules/.bin/playwright",
			["test", `data/versioned/tests/${filename}`, "--reporter=line,./src/step-reporter.cjs", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
			{
				cwd: E2E_DIR,
				env: {
					PATH: envLocal.PATH || process.env.PATH,
					HOME: testRunner.identity.uid ? testRunner.home : process.env.HOME,
					HEADLESS: envLocal.HEADLESS || process.env.HEADLESS,
					...(baseUrl ? { BASE_URL: baseUrl } : {}),
					E2E_ENV_VARS: envVarsToJson(envVars),
				},
				stdio: ["ignore", "pipe", "pipe"],
				...testRunner.identity,
			},
		);

		run.kill = () => {
			try { proc.kill("SIGKILL"); } catch {}
			killStrayBrowsers();
		};

		const autoKillTimer = autoKillAfterTimeout(run);
		const push = forwardOutput(run);
		proc.stdout.on("data", push);
		proc.stderr.on("data", push);

		proc.on("close", async (code) => {
			clearTimeout(autoKillTimer);
			run.status = code === 0 ? "passed" : "failed";
			// Lifecycle metadata for the "Liste des tests" tab: remember the
			// environment this run targeted, and the duration when it passed.
			testMeta.recordRun(filename.replace(/\.spec\.ts$/, ""), {
				success: code === 0,
				durationMs: Date.now() - startTime,
				environmentId: environment?.id ?? null,
				environmentName: environment?.name ?? null,
			});
			if (code === 0) await testsService.recordRunDuration(filename, Date.now() - startTime);
			const newEstimatedMs = testsService.estimatedMs(await testsService.loadRunHistory(), filename);
			const msg = `data: ${JSON.stringify({ done: true, status: run.status, estimatedMs: newEstimatedMs })}\n\n`;
			for (const res of run.clients) {
				res.write(msg);
				res.end();
			}
			run.clients.clear();
		});

		return runId;
	}

	// Runs a staged (not yet confirmed) spec: copied into TESTS_DIR under a
	// temp name (Playwright only discovers files inside its testDir), then
	// cleaned up when the process exits.
	function startPendingRun(testname, { baseUrl, environment }) {
		const tempName = `_pending_${testname}`;
		const tempFile = path.join(TESTS_DIR, tempName + ".spec.ts");
		fs.mkdirSync(TESTS_DIR, { recursive: true });
		fs.copyFileSync(path.join(PENDING_DIR, testname + ".spec.ts"), tempFile);
		try { fs.chmodSync(tempFile, 0o640); } catch {} // restore group-read for e2erunner (umask 077 strips it)

		const { runId, run } = createRun();
		const proc = spawn(
			"npx",
			["playwright", "test", `data/versioned/tests/${tempName}.spec.ts`, "--reporter=list,./src/step-reporter.cjs", "--project=chromium", ...(process.env.HEADLESS === "false" ? ["--headed"] : [])],
			{ cwd: E2E_DIR, env: { ...process.env, ...envLocal, ...(baseUrl ? { BASE_URL: baseUrl } : {}), E2E_ENV_VARS: envVarsToJson(environment?.variables) }, detached: true }
		);
		run.kill = () => {
			try { process.kill(-proc.pid, "SIGKILL"); } catch {}
			killStrayBrowsers();
		};
		const autoKillTimer = autoKillAfterTimeout(run);
		const push = forwardOutput(run);
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

		return runId;
	}

	return {
		startTestRun,
		startPendingRun,
		get: (runId) => runs.get(runId),
	};
};
