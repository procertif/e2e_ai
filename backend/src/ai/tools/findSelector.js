const fs = require("fs");
const { spawn } = require("child_process");

module.exports = function createFindSelector({ testedRepo, truncate }) {
	return function findSelector(input, ctx) {
		const environment = ctx?.environment;
		if (!environment) return "No target environment is selected for this conversation.";
		if (!environment.branch) return "This environment has no repository branch configured — add one on the Environments page first.";
		const dir = testedRepo.repoDirFor(environment.branch);
		if (!fs.existsSync(dir)) return "The repository hasn't been fetched yet for this environment — go to the Environments page and press Fetch.";
		if (typeof input.query !== "string" || !input.query.trim()) return "Error: query is required.";
		return new Promise((resolve) => {
			const proc = spawn(
				"grep",
				[
					"-rn", "-I", "-F", "-m", "5",
					"--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude-dir=vendor", "--exclude-dir=var", "--exclude-dir=cache",
					input.query, ".",
				],
				{ cwd: dir },
			);
			let output = "";
			proc.stdout.on("data", (d) => { output += d.toString(); });
			proc.on("close", () => resolve(truncate(output.trim() || "No match found.")));
			proc.on("error", (e) => resolve("Error: " + e.message));
		});
	};
};
