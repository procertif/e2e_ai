const path = require("path");

const BACKEND_DIR = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.resolve(BACKEND_DIR, "..");

// Every directory the backend reads/writes, derived from a single data root.
// `dataDir` is overridable so tests can point the whole app at a throwaway
// temp directory instead of the real data/.
function createPaths({ dataDir } = {}) {
	const DATA_DIR = dataDir ? path.resolve(dataDir) : path.resolve(E2E_DIR, "data");
	const VERSIONED_DIR = path.join(DATA_DIR, "versioned");
	return {
		BACKEND_DIR,
		E2E_DIR,
		DATA_DIR,
		VERSIONED_DIR,
		I18N_DIR: path.join(BACKEND_DIR, "i18n"),
		SCREENSHOTS_DIR: path.join(DATA_DIR, "screenshots"),
		TESTS_DIR: path.join(VERSIONED_DIR, "tests"),
		GROUPS_DIR: path.join(VERSIONED_DIR, "groups"),
		SCENARIOS_DIR: path.join(VERSIONED_DIR, "scenarios"),
		CAMPAIGNS_DIR: path.join(VERSIONED_DIR, "campaigns"),
		PENDING_DIR: path.join(DATA_DIR, "pending"),
		CORRECTIONS_DIR: path.join(DATA_DIR, "corrections"),
		CREATIONS_DIR: path.join(DATA_DIR, "creations"),
		TEST_META_DIR: path.join(DATA_DIR, "testMeta"),
		ACTION_TESTS_DIR: path.join(DATA_DIR, "actionTest"),
		TESTED_REPOS_DIR: path.join(DATA_DIR, "testedRepositories"),
		// Sibling to (not inside) versioned/ — environments hold plaintext
		// variable values (OTP codes, tokens…) that must never end up in the
		// data/versioned/ backup repo.
		ENVIRONMENTS_DIR: path.join(DATA_DIR, "environments"),
		// Also sibling to versioned/ — operator-local app configuration
		// (system prompt overrides…), not test assets to sync/push.
		CONFIG_DIR: path.join(DATA_DIR, "config"),
		TEST_UTILS_PATH: path.join(E2E_DIR, "src", "testUtils.ts"),
		FRONTEND_DIST: path.join(E2E_DIR, "frontend", "dist"),
	};
}

module.exports = { BACKEND_DIR, E2E_DIR, createPaths };
