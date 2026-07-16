const https = require("https");
const fs = require("fs");
const path = require("path");
const { runGit } = require("../../core/git");
const { parseGitHubRepoUrl } = require("../../core/githubUrl");

// Checks out the single configured GitHub repo's branches into
// data/testedRepositories/<branch>/, the read-only source the AI's
// FindSelector tool searches to find real selectors instead of guessing.
// Keyed by branch, not by environment — two environments tracking the same
// branch share one checkout instead of duplicating it.
module.exports = function createTestedRepoService({ TESTED_REPOS_DIR, envLocal }) {
	const GITHUB_TOKEN = envLocal.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
	const GITHUB_REPO_URL = envLocal.GITHUB_REPO_URL || process.env.GITHUB_REPO_URL;

	function parseRepo() {
		return parseGitHubRepoUrl(GITHUB_REPO_URL);
	}

	function isConfigured() {
		return Boolean(GITHUB_TOKEN && parseRepo());
	}

	function redactToken(str) {
		return GITHUB_TOKEN ? str.split(GITHUB_TOKEN).join("[REDACTED]") : str;
	}

	function githubApi(pathname) {
		return new Promise((resolve, reject) => {
			https
				.get(
					{
						hostname: "api.github.com",
						path: pathname,
						headers: {
							Authorization: `Bearer ${GITHUB_TOKEN}`,
							"User-Agent": "procertif-e2e",
							Accept: "application/vnd.github+json",
						},
					},
					(res) => {
						let body = "";
						res.on("data", (c) => (body += c));
						res.on("end", () => {
							if (res.statusCode >= 400) {
								reject(new Error(redactToken(`GitHub API ${res.statusCode}: ${body.slice(0, 300)}`)));
								return;
							}
							try {
								resolve(JSON.parse(body));
							} catch (e) {
								reject(e);
							}
						});
					},
				)
				.on("error", (e) => reject(new Error(redactToken(e.message))));
		});
	}

	async function listBranches() {
		const repo = parseRepo();
		if (!GITHUB_TOKEN || !repo) throw new Error("GITHUB_TOKEN / GITHUB_REPO_URL not configured.");
		const branches = [];
		for (let page = 1; page <= 10; page++) {
			const data = await githubApi(`/repos/${repo.owner}/${repo.repo}/branches?per_page=100&page=${page}`);
			if (!Array.isArray(data) || data.length === 0) break;
			branches.push(...data.map((b) => b.name));
			if (data.length < 100) break;
		}
		return branches;
	}

	async function getBranchHeadSha(branch) {
		const repo = parseRepo();
		if (!GITHUB_TOKEN || !repo) throw new Error("GITHUB_TOKEN / GITHUB_REPO_URL not configured.");
		const data = await githubApi(`/repos/${repo.owner}/${repo.repo}/branches/${encodeURIComponent(branch)}`);
		return data?.commit?.sha || null;
	}

	function slugifyBranch(branch) {
		return (
			(branch || "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 40) || "branch"
		);
	}

	function repoDirFor(branch) {
		return path.join(TESTED_REPOS_DIR, slugifyBranch(branch));
	}

	function deleteRepoDir(branch) {
		fs.rmSync(repoDirFor(branch), { recursive: true, force: true });
	}

	// Reads the currently checked-out commit without hitting the network —
	// used to compare against the branch's live GitHub head for "update
	// available", and to show a short sha on the Environments page.
	async function getCheckedOutSha(branch) {
		const dir = repoDirFor(branch);
		if (!fs.existsSync(path.join(dir, ".git"))) return null;
		try {
			const sha = await runGit(["rev-parse", "HEAD"], dir, redactToken);
			return sha.trim();
		} catch {
			return null;
		}
	}

	// Clones on first use, otherwise fetch + hard-reset to the branch's tip —
	// keeps a single up-to-date working copy per branch (shared by every
	// environment tracking it) rather than piling up history or duplicates.
	// Returns the checked-out commit sha.
	async function fetchRepo(branch) {
		const repo = parseRepo();
		if (!GITHUB_TOKEN || !repo) throw new Error("GITHUB_TOKEN / GITHUB_REPO_URL not configured.");
		if (!branch) throw new Error("No branch selected.");
		const dir = repoDirFor(branch);
		fs.mkdirSync(TESTED_REPOS_DIR, { recursive: true });
		const authedUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo.owner}/${repo.repo}.git`;

		if (fs.existsSync(path.join(dir, ".git"))) {
			await runGit(["remote", "set-url", "origin", authedUrl], dir, redactToken);
			await runGit(["fetch", "origin", branch], dir, redactToken);
			await runGit(["checkout", branch], dir, redactToken);
			await runGit(["reset", "--hard", `origin/${branch}`], dir, redactToken);
			await runGit(["clean", "-fdx"], dir, redactToken);
		} else {
			fs.rmSync(dir, { recursive: true, force: true });
			fs.mkdirSync(TESTED_REPOS_DIR, { recursive: true });
			await runGit(["clone", "--branch", branch, "--single-branch", authedUrl, dir], TESTED_REPOS_DIR, redactToken);
		}
		const sha = await runGit(["rev-parse", "HEAD"], dir, redactToken);
		return sha.trim();
	}

	return { isConfigured, listBranches, getBranchHeadSha, getCheckedOutSha, fetchRepo, repoDirFor, deleteRepoDir };
};
