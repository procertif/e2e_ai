const { spawn } = require("child_process");

// `redact` strips tokens from error messages before they can reach an HTTP
// response (authed remote URLs embed the token).
// Auth always travels in the remote URL (x-access-token:<TOKEN>@github.com),
// never through git's credential machinery — so any configured helper is
// explicitly disabled ("-c credential.helper=" clears the list). Without
// this, a global `credential.helper = store` would silently write the app's
// tokens into the PC user's ~/.git-credentials on every fetch/push (and
// could shadow their own GitHub credential). GIT_TERMINAL_PROMPT=0 makes a
// missing/expired token fail fast instead of hanging on a hidden prompt.
function runGit(args, cwd, redact = (s) => s) {
	return new Promise((resolve, reject) => {
		const proc = spawn("git", ["-c", "credential.helper=", ...args], {
			cwd,
			env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: "0" },
		});
		let output = "";
		proc.stdout.on("data", (d) => (output += d.toString()));
		proc.stderr.on("data", (d) => (output += d.toString()));
		proc.on("close", (code) => {
			if (code === 0) resolve(output);
			else reject(new Error(redact(output.trim() || `git ${args[0]} exited with code ${code}`)));
		});
		proc.on("error", (err) => reject(new Error(redact(err.message))));
	});
}

// Same as runGit but resolves null instead of rejecting — for calls whose
// failure is expected/harmless (e.g. fetching a remote branch that doesn't
// exist yet on a brand-new repo).
async function tryGit(args, cwd, redact) {
	try {
		return await runGit(args, cwd, redact);
	} catch {
		return null;
	}
}

module.exports = { runGit, tryGit };
