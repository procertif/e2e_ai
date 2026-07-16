const express = require("express");
const path = require("path");
const cors = require("./core/http/cors");

// Assembles the HTTP layer from a container (see container.js). Kept
// separate from server.js so tests can mount the app on an ephemeral port
// without the entry point's side effects (umask, watchers, reaper).
function createApp(container) {
	const app = express();

	app.use(cors);
	app.use(express.json({ limit: "25mb" }));

	// Public routes — everything else under /api requires a valid JWT.
	app.use(require("./core/auth/auth.controller")(container));
	app.use(require("./modules/i18n/i18n.controller")({ I18N_DIR: container.paths.I18N_DIR, envLocal: container.envLocal }));
	const screenshots = require("./modules/screenshots/screenshots.controller")(container);
	app.use(screenshots.publicRouter);

	const api = express.Router();
	app.use("/api", container.auth.requireAuth, api);

	api.use(require("./modules/tests/tests.controller")(container));
	api.use(screenshots.apiRouter);
	api.use(require("./modules/groups/groups.controller")(container));
	api.use(require("./modules/session/session.controller")(container));
	api.use(require("./modules/environments/environments.controller")(container));
	api.use(require("./modules/testedRepo/testedRepo.controller")(container));
	api.use(require("./modules/campaigns/campaigns.controller")(container));
	api.use(require("./modules/corrections/corrections.controller")(container));
	api.use(require("./modules/testRuns/testRuns.controller")(container));
	api.use(require("./modules/pending/pending.controller")(container));
	api.use(require("./modules/scenarios/scenarios.controller")(container));
	api.use(require("./modules/chat/chat.controller")(container));
	api.use(require("./modules/aiQueue/aiQueue.controller")(container));
	api.use(require("./modules/versionedRepo/versionedRepo.controller")(container));
	api.use(require("./modules/promptsConfig/promptsConfig.controller")(container));

	// React SPA (built by frontend/) — any non-API path falls back to
	// index.html for client-side routing.
	app.use(express.static(container.paths.FRONTEND_DIST));
	app.get(/^(?!\/api).*/, (req, res) => {
		res.sendFile(path.join(container.paths.FRONTEND_DIST, "index.html"));
	});

	app.use((req, res) => {
		res.status(404).send("Not found");
	});

	app.use((err, req, res, next) => {
		res.status(400).json({ error: "Bad request" });
	});

	return app;
}

module.exports = { createApp };
