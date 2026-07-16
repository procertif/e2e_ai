const path = require("path");
const { parseEnvFile } = require("../core/envFile");
const { E2E_DIR } = require("./paths");

// Loads .env (overridable for tests) and derives the few runtime settings
// read at startup. TEST_RUNNER_* are set only inside the Docker image (see
// docker-entrypoint.sh) — undefined in local dev, where the current user
// can't setuid to an arbitrary account anyway. When present, every spawned
// test process runs as this restricted account instead of the backend's own
// (root) identity.
function loadRuntimeEnv(envOverride) {
	const envLocal = envOverride || parseEnvFile(path.join(E2E_DIR, ".env"));
	const get = (key) => envLocal[key] || process.env[key];
	const uid = Number(get("TEST_RUNNER_UID"));
	const gid = Number(get("TEST_RUNNER_GID"));
	return {
		envLocal,
		port: Number(get("PORT") || 3333),
		testRunner: {
			identity: Number.isInteger(uid) && Number.isInteger(gid) ? { uid, gid } : {},
			home: get("TEST_RUNNER_HOME"),
		},
	};
}

module.exports = { loadRuntimeEnv };
