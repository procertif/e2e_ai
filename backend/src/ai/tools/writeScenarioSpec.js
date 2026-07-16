// Only reachable from scenario conversations (SCENARIO_TOOLS) — replaces
// the expected-result Gherkin spec of the scenario the run is scoped to.
const GHERKIN_PREFIXES = ["Étant donné", "Étant donnés", "Étant données", "Quand", "Lorsque", "Alors", "Et", "Mais"];

module.exports = function createWriteScenarioSpec() {
	return function writeScenarioSpec(input, ctx) {
		if (!ctx?.scenarioName || !ctx?.scenarios) return "Error: this conversation is not scoped to a scenario.";
		const content = typeof input.content === "string" ? input.content.trim() : "";
		if (!content) return "Error: content is required.";
		const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
		const invalid = lines.filter((l) => !GHERKIN_PREFIXES.some((p) => l.startsWith(p)));
		if (invalid.length > 0) {
			return `Error: every non-empty line must start with one of: ${GHERKIN_PREFIXES.join(", ")}. Invalid line(s):\n${invalid.join("\n")}`;
		}
		if (lines.length > 15) {
			return `Error: the specification must stay concise (max 15 lines, got ${lines.length}). Split into several scenarios instead.`;
		}
		ctx.scenarios.upsert(ctx.scenarioName, { spec: content });
		return `Specification of "${ctx.scenarioName}" updated (${lines.length} lines).`;
	};
};
