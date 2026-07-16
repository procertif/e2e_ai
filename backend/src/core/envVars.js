// Serializes an environment's [{ key, value }] list into the E2E_ENV_VARS
// JSON blob consumed by src/testUtils.ts's getEnvironmentVariable().
function envVarsToJson(variables) {
	return JSON.stringify(Object.fromEntries((variables || []).map((v) => [v.key, v.value])));
}

module.exports = { envVarsToJson };
