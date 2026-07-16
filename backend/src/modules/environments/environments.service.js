const ENVIRONMENT_COLORS = require("./environmentColors");

const VARIABLE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Returns the sanitized variables array, or null if the input is invalid.
function sanitizeVariables(input) {
	if (input === undefined) return [];
	if (!Array.isArray(input)) return null;
	const seen = new Set();
	const variables = [];
	for (const raw of input) {
		const key = typeof raw?.key === "string" ? raw.key.trim() : "";
		const value = typeof raw?.value === "string" ? raw.value : "";
		const description = typeof raw?.description === "string" ? raw.description.trim() || null : null;
		if (!VARIABLE_KEY_RE.test(key)) return null;
		if (seen.has(key)) return null;
		seen.add(key);
		variables.push({ key, value, description });
	}
	return variables;
}

function isValidColor(color) {
	return ENVIRONMENT_COLORS.includes(color);
}

module.exports = function createEnvironmentsService({ environmentsRepo, testedRepo }) {
	// Repo checkouts are shared by branch — several environments tracking the
	// same branch read the same data/testedRepositories/<branch>/ dir, so
	// status (checked-out sha, remote head) is keyed by branch too, not by
	// environment id.
	async function branchStatus(branch) {
		if (!branch || !testedRepo.isConfigured()) return { lastFetchedCommit: null, hasUpdate: false };
		const lastFetchedCommit = await testedRepo.getCheckedOutSha(branch).catch(() => null);
		try {
			const headSha = await testedRepo.getBranchHeadSha(branch);
			return { lastFetchedCommit, hasUpdate: Boolean(headSha && lastFetchedCommit && headSha !== lastFetchedCommit) };
		} catch {
			return { lastFetchedCommit, hasUpdate: false };
		}
	}

	async function listWithUpdateStatus() {
		const environments = environmentsRepo.list();
		const statusByBranch = new Map();
		return Promise.all(
			environments.map(async (env) => {
				if (!env.branch) return { ...env, lastFetchedCommit: null, hasUpdate: false };
				if (!statusByBranch.has(env.branch)) statusByBranch.set(env.branch, branchStatus(env.branch));
				return { ...env, ...(await statusByBranch.get(env.branch)) };
			}),
		);
	}

	// If no other environment still tracks a branch, its shared checkout is
	// unused — remove it rather than leaving an orphaned clone behind.
	function deleteBranchCheckoutIfOrphaned(branch) {
		if (!branch) return;
		const stillUsed = environmentsRepo.list().some((e) => e.branch === branch);
		if (!stillUsed) testedRepo.deleteRepoDir(branch);
	}

	function create(data) {
		return environmentsRepo.create(data);
	}

	function update(id, data, previousBranch) {
		const environment = environmentsRepo.update(id, data);
		if (!environment) return null;
		if (previousBranch && previousBranch !== environment.branch) {
			deleteBranchCheckoutIfOrphaned(previousBranch);
		}
		return environment;
	}

	function remove(id) {
		const environment = environmentsRepo.get(id);
		environmentsRepo.remove(id);
		if (environment?.branch) deleteBranchCheckoutIfOrphaned(environment.branch);
	}

	return { branchStatus, listWithUpdateStatus, create, update, remove };
};

module.exports.sanitizeVariables = sanitizeVariables;
module.exports.isValidColor = isValidColor;
