module.exports = function createListEnvironmentVariables() {
	return function listEnvironmentVariables(input, ctx) {
		const environment = ctx?.environment;
		if (!environment) return "No target environment is selected for this conversation.";
		const variables = (environment.variables || []).map((v) => ({ key: v.key, description: v.description || null }));
		return JSON.stringify({ environmentName: environment.name, variables }, null, 2);
	};
};
