const fs = require("fs");
const { createPaths } = require("./config/paths");
const { loadRuntimeEnv } = require("./config/runtimeEnv");

// Builds and wires every service of the app. Options exist for tests:
// `dataDir` points the whole app at a throwaway data directory, `envLocal`
// replaces .env, and `ai` swaps the real Anthropic-backed AI for a fake.
function createContainer({ dataDir, envLocal: envOverride, ai: aiOverride } = {}) {
	const paths = createPaths({ dataDir });
	fs.mkdirSync(paths.TESTS_DIR, { recursive: true });
	const { envLocal, port, testRunner } = loadRuntimeEnv(envOverride);

	const db = require("./core/db");
	const auth = require("./core/auth/auth.service")({ envLocal });

	const environmentsRepo = require("./modules/environments/environments.repository")({ ENVIRONMENTS_DIR: paths.ENVIRONMENTS_DIR });
	const groupsRepo = require("./modules/groups/groups.repository")({ GROUPS_DIR: paths.GROUPS_DIR });
	const scenariosRepo = require("./modules/scenarios/scenarios.repository")({ SCENARIOS_DIR: paths.SCENARIOS_DIR });
	const campaignsRepo = require("./modules/campaigns/campaigns.repository")({ CAMPAIGNS_DIR: paths.CAMPAIGNS_DIR });
	const testMeta = require("./modules/testMeta/testMeta.service")({ TEST_META_DIR: paths.TEST_META_DIR });
	const corrections = require("./modules/corrections/corrections.repository")({ TESTS_DIR: paths.TESTS_DIR, CORRECTIONS_DIR: paths.CORRECTIONS_DIR, testMeta });
	const creations = require("./modules/creations/creations.repository")({ TESTS_DIR: paths.TESTS_DIR, CREATIONS_DIR: paths.CREATIONS_DIR, testMeta });

	const testedRepo = require("./modules/testedRepo/testedRepo.service")({ TESTED_REPOS_DIR: paths.TESTED_REPOS_DIR, envLocal });
	const versionedRepo = require("./modules/versionedRepo/versionedRepo.service")({ VERSIONED_DIR: paths.VERSIONED_DIR, envLocal });

	const groupsService = require("./modules/groups/groups.service")({ groupsRepo });
	const environmentsService = require("./modules/environments/environments.service")({ environmentsRepo, testedRepo });
	const campaignsService = require("./modules/campaigns/campaigns.service")({ campaignsRepo });
	const testsService = require("./modules/tests/tests.service")({ db, paths, scenariosRepo, groupsService, testMeta });
	const screenshotsService = require("./modules/screenshots/screenshots.service")({ SCREENSHOTS_DIR: paths.SCREENSHOTS_DIR, testsService });
	const testRuns = require("./modules/testRuns/testRuns.service")({ paths, envLocal, testRunner, testsService, testMeta });
	const pendingService = require("./modules/pending/pending.service")({ paths, scenariosRepo, testMeta });
	const chatService = require("./modules/chat/chat.service")({ db });
	const promptsConfig = require("./modules/promptsConfig/promptsConfig.service")({ CONFIG_DIR: paths.CONFIG_DIR });

	const ai = aiOverride || require("./ai")({
		paths,
		envLocal,
		testRunner,
		db,
		environments: environmentsRepo,
		scenarios: scenariosRepo,
		corrections,
		creations,
		testedRepo,
		promptsConfig,
	});

	const aiQueue = require("./modules/aiQueue/aiQueue.service")({ db, ai, corrections, creations, scenariosRepo });

	return {
		paths,
		envLocal,
		port,
		testRunner,
		db,
		auth,
		environmentsRepo,
		environmentsService,
		groupsRepo,
		groupsService,
		scenariosRepo,
		campaignsRepo,
		campaignsService,
		corrections,
		creations,
		testMeta,
		testedRepo,
		versionedRepo,
		testsService,
		screenshotsService,
		testRuns,
		pendingService,
		chatService,
		promptsConfig,
		ai,
		aiQueue,
	};
}

module.exports = { createContainer };
