const fs = require("fs");
const path = require("path");
const { runGit: rawRunGit, tryGit: rawTryGit } = require("../../core/git");
const { parseGitHubRepoUrl } = require("../../core/githubUrl");

// Backs up data/versioned/ (tests, groups, scenarios, campaigns — NOT
// environments, which live outside this tree specifically because they hold
// plaintext secret values) to a dedicated GitHub repo. data/versioned/
// itself becomes its own git working tree. Push/fetch only — the branch is
// whatever already exists on the remote (or "main" on a brand-new empty
// remote); nothing here ever creates an additional branch.
module.exports = function createVersionedRepoService({ VERSIONED_DIR, envLocal }) {
	const TOKEN = envLocal.TEST_GITHUB_TOKEN || process.env.TEST_GITHUB_TOKEN;
	const REPO_URL = envLocal.TEST_GITHUB_REPO_URL || process.env.TEST_GITHUB_REPO_URL;

	function parseRepo() {
		return parseGitHubRepoUrl(REPO_URL);
	}

	function isConfigured() {
		return Boolean(TOKEN && parseRepo());
	}

	function redactToken(str) {
		return TOKEN ? str.split(TOKEN).join("[REDACTED]") : str;
	}

	function authedUrl() {
		const r = parseRepo();
		return `https://x-access-token:${TOKEN}@github.com/${r.owner}/${r.repo}.git`;
	}

	function runGit(args, cwd = VERSIONED_DIR) {
		return rawRunGit(args, cwd, redactToken);
	}

	function tryGit(args, cwd = VERSIONED_DIR) {
		return rawTryGit(args, cwd, redactToken);
	}

	async function ensureRepo() {
		if (!isConfigured()) throw new Error("TEST_GITHUB_TOKEN / TEST_GITHUB_REPO_URL not configured.");
		fs.mkdirSync(VERSIONED_DIR, { recursive: true });
		if (!fs.existsSync(path.join(VERSIONED_DIR, ".git"))) {
			await runGit(["init"]);
			await runGit(["config", "user.name", "Procertif E2E"]);
			await runGit(["config", "user.email", "e2e@procertif.local"]);
		}
		// Test/scenario names carry accented characters (é, à…) — without this,
		// git quotes those paths and octal-escapes the bytes in --name-status
		// output, which breaks category/filename parsing downstream.
		await runGit(["config", "core.quotePath", "false"]);
		const remotes = (await tryGit(["remote"])) || "";
		if (remotes.split("\n").includes("origin")) {
			await runGit(["remote", "set-url", "origin", authedUrl()]);
		} else {
			await runGit(["remote", "add", "origin", authedUrl()]);
		}
	}

	// The remote's actual default branch, so we never introduce a branch name
	// of our own — "main" is only a bootstrap fallback for a repo with no
	// commits at all yet (there's no existing branch to defer to).
	async function detectBranch() {
		const out = await tryGit(["ls-remote", "--symref", "origin", "HEAD"]);
		const m = out && out.match(/ref:\s+refs\/heads\/(\S+)/);
		return (m && m[1]) || "main";
	}

	// A merge left unresolved (conflict) is visible directly on disk via
	// MERGE_HEAD — deriving state from there (rather than an in-memory flag)
	// means it survives a server restart instead of leaving a stuck repo.
	async function getConflictState() {
		if (!fs.existsSync(path.join(VERSIONED_DIR, ".git", "MERGE_HEAD"))) return null;
		const statusOut = (await tryGit(["status", "--porcelain"])) || "";
		const files = statusOut
			.split("\n")
			.filter((l) => /^(UU|AA|DD|AU|UA|UD|DU) /.test(l))
			.map((l) => l.slice(3));
		return { files };
	}

	async function fetchRemote() {
		await ensureRepo();
		// `git diff <ref>` never surfaces untracked paths — only ones already
		// known to git (tracked or staged) — so a brand-new file that was never
		// git-add'ed would silently disappear from every diff/status view below
		// without this. Staging doesn't touch working-tree content, it's purely
		// bookkeeping, and push() re-stages anyway.
		await tryGit(["add", "-A"]);
		const branch = await detectBranch();
		await tryGit(["fetch", "origin", branch]);
		return branch;
	}

	// Raw `git diff origin/branch` can't tell "local made this change" apart
	// from "remote moved and local just hasn't caught up" — a file the REMOTE
	// deleted reads as locally "Added" (it exists locally, absent on origin)
	// even though local never touched it. Comparing both sides against their
	// common ancestor tells them apart: if only the remote changed a path
	// since that point, local is merely stale on it.
	async function computeDiffEntries() {
		const branch = await fetchRemote();
		const hasRemoteBranch = Boolean(await tryGit(["rev-parse", "--verify", `origin/${branch}`]));
		let entries;
		if (!hasRemoteBranch) {
			// Nothing to diff against yet — every local file reads as "new".
			const out = (await tryGit(["ls-files"])) || "";
			entries = out.split("\n").filter(Boolean).map((file) => ({ status: "A", file }));
		} else {
			const out = (await tryGit(["diff", `origin/${branch}`, "--name-status", "--", "."])) || "";
			entries = out
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					const [status, ...rest] = line.split("\t");
					return { status, file: rest.join("\t") };
				});
			const mergeBase = ((await tryGit(["merge-base", "HEAD", `origin/${branch}`])) || "").trim();
			if (mergeBase) {
				const remoteChanged = new Set(
					((await tryGit(["diff", mergeBase, `origin/${branch}`, "--name-only", "--", "."])) || "").split("\n").filter(Boolean)
				);
				const localChanged = new Set(
					((await tryGit(["diff", mergeBase, "--name-only", "--", "."])) || "").split("\n").filter(Boolean)
				);
				entries = entries.map((e) => (remoteChanged.has(e.file) && !localChanged.has(e.file) ? { ...e, status: "stale" } : e));
			}
		}
		return { branch, hasRemoteBranch, entries };
	}

	async function getStatus() {
		if (!isConfigured()) return { configured: false };
		const { branch, hasRemoteBranch, entries } = await computeDiffEntries();
		const conflict = await getConflictState();
		const changedCount = entries.length;
		const hasStaleFiles = entries.some((e) => e.status === "stale");
		return { configured: true, branch, hasRemoteBranch, conflict, changedCount, hasStaleFiles };
	}

	async function getDiff() {
		if (!isConfigured()) throw new Error("TEST_GITHUB_TOKEN / TEST_GITHUB_REPO_URL not configured.");
		const { branch, entries } = await computeDiffEntries();
		const files = await Promise.all(
			entries.map(async (entry) => ({ ...entry, ...(await describeFile(entry.file, entry.status, branch)) }))
		);
		return { branch, files };
	}

	function humanizeTestname(name) {
		return name
			.replace(/[-_]+/g, " ")
			.trim()
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	// data/versioned/'s top-level folders map 1:1 to app entities. The
	// filename itself is a random id (or the raw testname for tests/
	// scenarios), so the display name is only recoverable by reading the
	// file's own content — for deletions that means reading it out of the
	// remote branch instead, since it's already gone from the working tree.
	async function readForNaming(file, status, branch) {
		if (status === "D") return await tryGit(["show", `origin/${branch}:${file}`]);
		try {
			return fs.readFileSync(path.join(VERSIONED_DIR, file), "utf-8");
		} catch {
			// "stale" covers remote-added files too — those never existed
			// locally, so the only place to read a name from is origin.
			if (status === "stale") return await tryGit(["show", `origin/${branch}:${file}`]);
			return null;
		}
	}

	async function describeFile(file, status, branch) {
		const [category, ...rest] = file.split("/");
		const base = path.basename(rest.join("/"));
		let name = base;
		try {
			if (category === "tests" && base.endsWith(".spec.ts")) {
				name = humanizeTestname(base.slice(0, -".spec.ts".length));
			} else if (category === "campaigns") {
				const data = JSON.parse((await readForNaming(file, status, branch)) || "{}");
				name = data.title || null;
			} else if (category === "groups") {
				const data = JSON.parse((await readForNaming(file, status, branch)) || "{}");
				name = data.name || humanizeTestname(base.replace(/\.json$/, ""));
			} else if (category === "scenarios") {
				const data = JSON.parse((await readForNaming(file, status, branch)) || "{}");
				name = data.description || humanizeTestname(data.testname || base.replace(/\.json$/, ""));
			} else {
				name = null;
			}
		} catch {
			name = null;
		}
		return { category, name };
	}

	function assertInsideVersioned(file) {
		const resolved = path.resolve(VERSIONED_DIR, file);
		if (resolved !== VERSIONED_DIR && !resolved.startsWith(VERSIONED_DIR + path.sep)) {
			throw new Error("Invalid file path.");
		}
		return resolved;
	}

	async function getFileDiff(file) {
		if (!isConfigured()) throw new Error("TEST_GITHUB_TOKEN / TEST_GITHUB_REPO_URL not configured.");
		assertInsideVersioned(file);
		const { branch, hasRemoteBranch, entries } = await computeDiffEntries();
		if (!hasRemoteBranch) {
			const content = await tryGit(["show", `:${file}`]).catch(() => null);
			return content || "";
		}
		const isStale = entries.some((e) => e.file === file && e.status === "stale");
		// Default direction is origin(old)→local(new) — right for a genuine
		// local edit, where the local content is what's "new". A stale file is
		// the opposite: only the remote moved, so showing it that same way
		// makes an upstream deletion look like a local addition (all "+").
		// -R flips it to local(old)→origin(new): what sync is about to do.
		return (await tryGit(isStale ? ["diff", "-R", `origin/${branch}`, "--", file] : ["diff", `origin/${branch}`, "--", file])) || "";
	}

	// Commits whatever's on disk (so it's never lost) and merges in the
	// remote branch if it has moved ahead — the shared first half of both
	// sync() (stop here) and push() (also publish afterwards). Stops and
	// reports the conflicting files instead of guessing a resolution.
	async function syncLocal() {
		await ensureRepo();
		const branch = await detectBranch();

		const existingConflict = await getConflictState();
		if (existingConflict) return { conflict: existingConflict, branch };

		await runGit(["add", "-A"]);
		const staged = ((await tryGit(["diff", "--cached", "--name-only"])) || "").trim();
		if (staged) await runGit(["commit", "-m", `Sync from Procertif E2E — ${new Date().toISOString()}`]);

		await tryGit(["fetch", "origin", branch]);
		const hasRemoteBranch = Boolean(await tryGit(["rev-parse", "--verify", `origin/${branch}`]));
		if (hasRemoteBranch) {
			const behind = Number(((await tryGit(["rev-list", `HEAD..origin/${branch}`, "--count"])) || "0").trim());
			if (behind > 0) {
				await tryGit(["merge", `origin/${branch}`, "--no-edit"]);
				const conflict = await getConflictState();
				if (conflict) return { conflict, branch };
			}
		}

		return { synced: true, branch };
	}

	// "Synchroniser" — makes local match remote (fetch + merge), without
	// publishing anything. This is the only thing that actually rewrites
	// files on disk; getStatus/getDiff's own fetch never touches the working
	// tree, so browsing the page never mutates local state.
	async function sync() {
		return await syncLocal();
	}

	async function push() {
		const result = await syncLocal();
		if (result.conflict) return result;

		await runGit(["push", "origin", `HEAD:${result.branch}`]);
		return { pushed: true, branch: result.branch };
	}

	// resolution: "local" keeps our version of every conflicting file
	// (git checkout --ours), "remote" takes the repo's version instead
	// (--theirs) — since the working tree is what the app actually reads
	// from disk, checking out --theirs is what puts the remote content back
	// in context for the running app.
	async function resolveConflict(resolution) {
		const conflict = await getConflictState();
		if (!conflict) throw new Error("No merge conflict in progress.");
		if (resolution !== "local" && resolution !== "remote") throw new Error('resolution must be "local" or "remote".');
		const branch = await detectBranch();
		const side = resolution === "remote" ? "--theirs" : "--ours";
		for (const file of conflict.files) {
			await runGit(["checkout", side, "--", file]);
			await runGit(["add", "--", file]);
		}
		await runGit(["commit", "--no-edit"]);
		await runGit(["push", "origin", `HEAD:${branch}`]);
		return { pushed: true, branch, resolution };
	}

	return { isConfigured, getStatus, getDiff, getFileDiff, sync, push, resolveConflict };
};
