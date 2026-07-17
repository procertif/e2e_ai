// Owner-only by default for every file/dir this process creates — a
// one-time chmod sweep (docker-entrypoint.sh) only fixes permissions on what
// already exists at container start; anything written afterward (a saved
// environment, a new correction draft) would otherwise fall back to Node's
// normal world-readable default. The restricted test-runner account still
// needs read access to a few specific paths (its spec file, node_modules,
// …) — those get it back explicitly, either via the entrypoint's one-time
// grant+setgid on data/versioned/tests, or via a direct chmod right after
// the handful of writes into that directory.
process.umask(0o077);

const fs = require("fs");
const { spawn } = require("child_process");
const { createContainer } = require("./container");
const { createApp } = require("./app");

const container = createContainer();
const app = createApp(container);

// Regenerate a test's Gherkin spec whenever its file changes on disk,
// debounced per test so a burst of writes only triggers one generation.
const specDebounce = new Map();
fs.watch(container.paths.TESTS_DIR, (eventType, filename) => {
	if (!filename || !filename.endsWith(".spec.ts")) return;
	// "_"-prefixed specs are ephemeral copies made for a single run
	// (_correction_*, _pending_*…) — generating a spec for them pollutes the
	// scenarios store with orphans.
	if (filename.startsWith("_")) return;
	const testname = filename.replace(".spec.ts", "");
	clearTimeout(specDebounce.get(testname));
	specDebounce.set(testname, setTimeout(() => {
		container.ai.generateSpec(testname).catch(() => {});
	}, 2000));
});

app.listen(container.port, () => {
	console.log(`Test runner available at http://localhost:${container.port}`);
	container.ai.generateMissingSpecs().catch(() => {});
});

// Reap zombie children re-parented from Chromium/Playwright.
// When Node.js reaps any direct child, libuv calls waitpid(-1, WNOHANG) in a
// loop, which picks up ALL pending zombies — including re-adopted ones.
setInterval(() => {
	const p = spawn("true", [], { stdio: "ignore" });
	p.on("error", () => {});
	p.on("close", () => {});
}, 5000);
