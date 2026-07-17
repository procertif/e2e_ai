const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { isSafeTestname } = require("../../core/safeNames");
const { envVarsToJson } = require("../../core/envVars");

module.exports = function createRunTest({ E2E_DIR, TESTS_DIR, PENDING_DIR, testRunner, truncate }) {
	return function runTest(input, ctx) {
		// Playwright can only discover/run files inside testDir
		// (data/versioned/tests/) — a pending spec (or, in correction mode, the
		// in-memory draft) has to land there under a temp name first, and be
		// cleaned up afterwards either way.
		let specPath, cleanupTemp;
		if (ctx?.correctionFilename) {
			const filename = ctx.correctionFilename;
			const entry = ctx.corrections.get(filename);
			if (!entry) return "Error: this test is no longer in correction.";
			specPath = path.join(TESTS_DIR, `_correction_${filename.replace(/\.spec\.ts$/, "")}.spec.ts`);
			fs.mkdirSync(TESTS_DIR, { recursive: true });
			fs.writeFileSync(specPath, entry.draftContent);
			try { fs.chmodSync(specPath, 0o640); } catch {} // restore group-read for e2erunner (umask 077 strips it)
			cleanupTemp = true;
		} else {
			if (!isSafeTestname(input.testname)) return "Error: invalid testname.";
			const sourcePath = path.join(input.pending ? PENDING_DIR : TESTS_DIR, input.testname + ".spec.ts");
			if (!fs.existsSync(sourcePath)) return `Error: ${sourcePath} does not exist.`;
			const tempName = input.pending ? `_pending_${input.testname}` : input.testname;
			specPath = path.join(TESTS_DIR, tempName + ".spec.ts");
			cleanupTemp = Boolean(input.pending);
			if (input.pending) {
				fs.copyFileSync(sourcePath, specPath);
				try { fs.chmodSync(specPath, 0o640); } catch {} // restore group-read for e2erunner
			}
		}
		const environment = ctx?.environment;
		try { execSync('pkill -9 -f "playwright"'); } catch {}
		try { execSync('pkill -9 -f "chrome"'); } catch {}
		return new Promise((resolve) => {
			const proc = spawn(
				"node_modules/.bin/playwright",
				["test", specPath, "--reporter=line,./src/step-reporter.cjs", "--project=chromium"],
				{
					cwd: E2E_DIR,
					// Own process group so a kill can take down playwright AND its
					// workers/chromium in one shot (see killGroup below).
					detached: true,
					// Deliberately NOT spreading process.env/envLocal: this process
					// runs AI-authored code, and .env only ever holds backend
					// config/secrets (AUTH_TOKEN, JWT_PRIVATE_KEY, Anthropic
					// credentials) that must stay unreachable by the model — even
					// via something as simple as a stray console.log(process.env)
					// inside the test it wrote. Also runs as the restricted
					// e2erunner account whenever one is configured — filesystem
					// access, not just env vars, since arbitrary Node fs calls in
					// the test itself aren't blocked by an env allowlist (a symlink
					// to .env or a write to ~/.bashrc doesn't need any environment
					// variable at all).
					env: {
						PATH: process.env.PATH,
						HOME: testRunner.identity.uid ? testRunner.home : process.env.HOME,
						HEADLESS: "true",
						// In Docker the browsers live in a shared path (see Dockerfile),
						// not in the runner's HOME — forward it through the minimal env.
						...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
						...(environment?.url ? { BASE_URL: environment.url } : {}),
						E2E_ENV_VARS: envVarsToJson(environment?.variables),
					},
					...testRunner.identity,
				},
			);
			// ListEnvironmentVariables only ever hands out keys/descriptions —
			// scrub the actual values from anything leaving this tool (the live
			// stream AND the final result), so a test that accidentally echoes
			// one (console.log, a failed assertion message, …) can't hand it
			// back to the model or the browser through this side channel.
			const scrub = (text) => {
				for (const v of environment?.variables || []) {
					if (v.value) text = text.split(v.value).join(`[REDACTED:${v.key}]`);
				}
				return text;
			};
			// The line reporter redraws its progress in place with ANSI cursor
			// moves and no trailing "\n" — strip the escapes and turn "\r" into
			// a real line break so that progress reaches the chat as text
			// instead of sitting in the buffer until the run ends.
			const normalize = (text) =>
				text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\r\n?/g, "\n");
			let output = "";
			// Live console: forward complete lines as they arrive (see the
			// tool_output SSE event pushed by the run loops). Line-buffered
			// rather than raw chunks so scrub() can't be defeated by a secret
			// value split across two chunks.
			let lineBuf = "";
			const flushLines = (final) => {
				if (!ctx?.onToolOutput) return;
				// "\r" counts as a boundary too (in-place progress rewrites);
				// escape sequences never contain \r/\n, so a partial one can't
				// straddle the cut and escape the strip.
				const lastNl = final ? lineBuf.length - 1 : Math.max(lineBuf.lastIndexOf("\n"), lineBuf.lastIndexOf("\r"));
				if (lastNl === -1) return;
				const chunk = normalize(lineBuf.slice(0, lastNl + 1));
				lineBuf = lineBuf.slice(lastNl + 1);
				if (chunk) ctx.onToolOutput(scrub(chunk));
			};
			const onData = (d) => {
				const s = d.toString();
				output += s;
				lineBuf += s;
				flushLines(false);
			};
			proc.stdout.on("data", onData);
			proc.stderr.on("data", onData);
			// Killing only the main playwright process isn't enough: its workers
			// and chromium inherit the stdout/stderr pipes, and the promise below
			// resolves on "close", which only fires once every holder of those
			// pipes is gone. Kill the whole process group so nothing survives to
			// keep the pipes open.
			const killGroup = () => {
				try { process.kill(-proc.pid, "SIGKILL"); } catch {}
				try { proc.kill("SIGKILL"); } catch {}
			};
			// 360s, deliberately above the 300s test.setTimeout() the generated
			// specs use: Playwright's own timeout must fire first so the model
			// gets a real failure (which step, stack trace) instead of a bare
			// "Exit code: null" from our kill landing at the same instant.
			const killTimer = setTimeout(killGroup, 360_000);
			// Stopping a run (chat-stop, batch-stop) aborts the controller, but
			// that only takes effect between tools — a Playwright run would keep
			// going for up to 5 minutes with the UI honestly-but-uselessly stuck
			// on "en cours". Kill the process as soon as the abort lands; the
			// close handler below still runs and does all the usual cleanup.
			const onAbort = killGroup;
			if (ctx?.signal) {
				if (ctx.signal.aborted) onAbort();
				else ctx.signal.addEventListener("abort", onAbort, { once: true });
			}
			let finished = false;
			const finish = (code) => {
				if (finished) return;
				finished = true;
				clearTimeout(killTimer);
				ctx?.signal?.removeEventListener("abort", onAbort);
				if (cleanupTemp) { try { fs.unlinkSync(specPath); } catch {} }
				flushLines(true);
				const text = scrub(`Exit code: ${code}\n\n${normalize(output).trim() || "(no output)"}`);
				// A kill via abort isn't a verdict on the draft — don't record a
				// "failed" badge (nor overwrite the console) for a run the user
				// cancelled mid-flight. Otherwise the run's output also becomes
				// the correction's new console, so the Console tab would reflect
				// the LATEST execution instead of staying frozen on the campaign
				// failure that opened the correction.
				if (ctx?.correctionFilename && !ctx.signal?.aborted) {
					ctx.corrections.setLastRunStatus(ctx.correctionFilename, code === 0 ? "passed" : "failed", text);
				}
				resolve(truncate(text));
			};
			proc.on("close", finish);
			// Belt and braces: "close" needs every inherited stdout/stderr fd
			// gone, and a straggling grandchild could keep one open forever even
			// after the group kill. "exit" fires as soon as the main process
			// dies — give the pipes 5s to flush, then resolve with whatever
			// output we have rather than hanging the tool loop.
			proc.on("exit", (code) => { setTimeout(() => finish(code), 5_000); });
		});
	};
};
