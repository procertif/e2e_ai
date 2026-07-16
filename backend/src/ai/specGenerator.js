const fs = require("fs");
const path = require("path");
const { specGenerationPrompt } = require("./prompts");

// Generates the human-readable Gherkin spec stored on each scenario, from
// the test's code + action list.
module.exports = function createSpecGenerator({ TESTS_DIR, client, scenarios }) {
	async function generateSpec(testname) {
		const testFile = path.join(TESTS_DIR, testname + ".spec.ts");

		let testCode = "", actionsText = "";
		try { testCode = fs.readFileSync(testFile, "utf-8"); } catch { return; }
		try {
			const scenario = scenarios.get(testname);
			if (scenario) actionsText = JSON.stringify({ actions: scenario.actions || [] });
		} catch {}

		try {
			const token = await client.getOAuthToken();
			let spec = "";
			await client.callClaudeStream(token, [{ role: "user", content: specGenerationPrompt(testCode, actionsText) }], (event) => {
				if (event.type === "delta" && event.text) spec += event.text;
			});
			if (!spec.trim()) throw new Error("Contenu vide reçu");
			scenarios.upsert(testname, { spec });
			console.log(`[spec] Généré : ${testname} (${spec.length} chars)`);
		} catch (e) {
			console.error(`[spec] Erreur pour ${testname}:`, e.message || String(e));
		}
	}

	async function generateMissingSpecs() {
		if (!fs.existsSync(TESTS_DIR)) return;
		for (const f of fs.readdirSync(TESTS_DIR).filter(f => f.endsWith(".spec.ts"))) {
			const testname = f.replace(".spec.ts", "");
			if (!scenarios.get(testname)?.spec) {
				generateSpec(testname).catch(() => {});
			}
		}
	}

	return { generateSpec, generateMissingSpecs };
};
