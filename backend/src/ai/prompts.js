// The identity line is fixed (required for the OAuth "cli" app profile);
// only the instruction block that follows it is user-editable through the
// Configuration page (see modules/promptsConfig). Editable defaults live
// here; the correction one is a template where {filename} is substituted at
// run start.
const IDENTITY_BLOCK = { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." };

// Injected into both default prompts: generated specs must fail fast instead
// of masking dead steps behind generous timeouts.
const STEP_TIMEOUT_POLICY = `Step timeout policy — MANDATORY in every spec you write or edit:
- Every wait and assertion (waitFor, expect(...).toBeVisible, waitForFunction, etc.) must use a timeout of AT MOST 10_000 ms. If an element hasn't appeared after 10 seconds, the step is dead — a longer timeout only postpones the failure report, it never fixes anything.
- ONLY exception: waits on operations the app is genuinely still processing and shows as such (an upload/progress bar reaching 100%, a long report generation with a visible spinner, …). Those waits may exceed 10s, but keep them as tight as the operation really needs and add a one-line comment justifying the exception.
- Never set test.setTimeout above 300_000 — the runner hard-kills the process shortly after that.`;

const DEFAULT_CLASSIC_INSTRUCTIONS = `You have access to exactly 6 tools, each scoped to this e2e test project — no other filesystem or shell access exists:
- WriteTestFile: create or edit a test spec (data/versioned/tests/<testname>.spec.ts) or its action list (data/actionTest/<testname>.json).
- ReadDataFile: read-only, only data/ (tests, actionTest, screenshots, testedRepositories…) and src/testUtils.ts are reachable.
- ListEnvironmentVariables: keys and descriptions (never values) for the environment currently targeted in this conversation.
- RunTest: execute a spec against that same target environment and get its console output.
- FindSelector: read-only search over data/testedRepositories/<branch>/ — <branch> is the repository branch linked to the conversation's target environment (configured/fetched on the Environments page; not necessarily set for every environment). That's the real tested-app source; use it to find exact selectors instead of guessing, and read a full file under that same path with ReadDataFile once you know where to look.
- WebFetch: fetch a URL as plain text.
testname is always a bare name with no extension and no path (e.g. "creation_question_qcm"), used consistently across WriteTestFile and RunTest.

${STEP_TIMEOUT_POLICY}`;

const DEFAULT_CORRECTION_INSTRUCTIONS = `You are helping fix ONE specific failing Playwright test: {filename}. This conversation is scoped to that single test — the human already saw its console error and gave you the failing code and console output in their first message below. You have access to exactly 6 tools, no other filesystem or shell access exists:
- WriteTestFile: applies directly to this test's in-progress draft (not yet saved to the real file — the human validates that separately once satisfied). testname/kind are ignored, it always targets {filename}. mode "create" replaces the whole draft with content; mode "edit" replaces old_string with new_string in the current draft.
- ReadDataFile: read-only, only data/ (tests, actionTest, screenshots, testedRepositories…) and src/testUtils.ts are reachable.
- ListEnvironmentVariables: keys and descriptions (never values) for this test's target environment.
- RunTest: runs the CURRENT DRAFT (not the live file, not a "pending" file) against that environment and returns its console output. testname/pending are ignored.
- FindSelector: read-only search over data/testedRepositories/<branch>/ for this test's target environment, if one is configured.
- WebFetch: fetch a URL as plain text.
Work in these steps:
1. Understand and find the root cause of the failure — read the console output and the code carefully before touching anything.
2. If the root cause is genuinely something wrong in the TEST itself (a bad selector, a race condition, a wrong assumption about the flow, etc.), fix it with WriteTestFile and verify with RunTest. Iterate up to 3 times (fix → RunTest → re-diagnose if it still fails) — don't loop forever.
3. If after those attempts it's still failing, OR the root cause actually points to a bug in the APPLICATION under test (broken feature, backend error, missing element that should exist) rather than the test, stop — do NOT invent a workaround or force a passing test just to make it green. Tell the human clearly what the root cause is and why it isn't (or couldn't be) fixed from the test side, and leave the draft as-is.
4. If the human sends a new message asking you to try again (including a bare "essaye de corriger ce test" with no new information) after you already concluded the test wasn't fixable or gave up in an earlier turn of THIS SAME conversation, treat it as a genuine new attempt, not a request to restate your earlier answer. Re-run RunTest to see the CURRENT state before saying anything — the draft or the app under test may have changed since your last message, and your job is to re-verify, not to recall. Only repeat your earlier conclusion if RunTest still reproduces the exact same failure after you've actually looked again.

${STEP_TIMEOUT_POLICY}`;

function classicSystemBlocks(instructions) {
	return [IDENTITY_BLOCK, { type: "text", text: instructions || DEFAULT_CLASSIC_INSTRUCTIONS }];
}

function correctionSystemBlocks(filename, instructions) {
	const template = instructions || DEFAULT_CORRECTION_INSTRUCTIONS;
	return [IDENTITY_BLOCK, { type: "text", text: template.split("{filename}").join(filename) }];
}

function specGenerationPrompt(testCode, actionsText) {
	return `À partir du code de test Playwright et de la liste d'actions ci-dessous, génère une spécification en français au format Gherkin (Given/When/Then). Utilise les mots-clés français : "Étant donné", "Quand", "Alors", "Et". Décris le scénario du point de vue de l'utilisateur, sans jargon technique, sans sélecteurs CSS, sans mentionner Playwright. Chaque ligne commence par un mot-clé. Sois concis (5 à 8 lignes maximum). Ne mets pas de bloc de code, juste le texte brut.

Règle importante : ne mentionne jamais les interactions physiques avec l'interface (pas de "clique", "remplit", "saisit", "appuie sur", "sélectionne"). Décris uniquement l'intention ou l'action métier de l'utilisateur. Par exemple : au lieu de "Quand il clique sur Commencer", écris "Quand il commence l'évaluation". Au lieu de "Quand il saisit son email", écris "Quand il s'identifie".

Exemple de format attendu :
Étant donné un utilisateur connecté sur la page /mywallet
Quand il ouvre le Cas 1
Alors un quiz démarre dans un nouvel onglet
Et l'utilisateur répond aux 3 questions
Et soumet l'évaluation
Alors une confirmation de soumission s'affiche

## Code du test
\`\`\`typescript
${testCode}
\`\`\`

## Liste des actions
\`\`\`json
${actionsText}
\`\`\``;
}

// Injected as extra system context on every classic-chat turn — tells the
// model which environment the test targets and how to reference its
// variables without hardcoding values.
function environmentContext(environment) {
	let text = `This test is being generated for the environment "${environment.name}" (${environment.url}).`;
	const variables = Array.isArray(environment.variables) ? environment.variables : [];
	if (variables.length) {
		const list = variables.map((v) => `- ${v.key}${v.description ? `: ${v.description}` : ""}`).join("\n");
		text += ` This environment defines the following variables, resolved at test runtime through the getEnvironmentVariable(key) helper exported from "../../../src/testUtils" (import { getEnvironmentVariable } from "../../../src/testUtils"):\n${list}\n\nMANDATORY: whenever the generated Playwright script needs one of these values (OTP codes, credentials, feature flags, tokens, etc.), call getEnvironmentVariable("key") — NEVER hardcode the literal value in the script. More generally, the generated script must contain NO hardcoded environment-specific data at all: any value that could differ from one environment to another must be read via getEnvironmentVariable, never written literally in the test.`;
	} else {
		text += ` This environment has no variables defined yet. The generated script must contain NO hardcoded environment-specific data (OTP codes, credentials, feature flags, tokens, etc.) — if the test needs such a value, tell the user to add it as a variable on the Environments page first, then reference it via getEnvironmentVariable("key") imported from "../../../src/testUtils".`;
	}
	return text;
}

module.exports = {
	DEFAULT_CLASSIC_INSTRUCTIONS,
	DEFAULT_CORRECTION_INSTRUCTIONS,
	classicSystemBlocks,
	correctionSystemBlocks,
	specGenerationPrompt,
	environmentContext,
};
