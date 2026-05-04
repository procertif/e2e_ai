import { test } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots", "cas4-quiz-noai");
const BASE_URL = "https://app.procertif.dev";
const EMAIL = "degertbenjamin3@gmail.com";
const OTP_CODE = "444444";

test.beforeAll(() => {
	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
});

test.use({
	launchOptions: { args: ["--start-maximized"] },
	viewport: null,
});

const shot = (newPage: import("@playwright/test").Page, n: number, label: string) =>
	newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${String(n).padStart(2, "0")}-${label}.png`), fullPage: true });

test("Cas 4 - Navigation avant/arrière + review", async ({ page }) => {
	test.setTimeout(240_000);

	// 1. Naviguer vers /mywallet
	await page.goto(`${BASE_URL}/mywallet`, { waitUntil: "domcontentloaded" });

	// 2. Login si nécessaire
	const passerBtn = page.getByRole("button", { name: /Passer l'évaluation/i }).first();
	const emailInput = page
		.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
		.first();
	await Promise.race([
		emailInput.waitFor({ state: "visible" }),
		passerBtn.waitFor({ state: "visible" }),
	]);
	await shot(page, 1, "mywallet");

	if (await emailInput.isVisible()) {
		await emailInput.fill(EMAIL);
		await page.getByRole("button", { name: /continuer|log me/i }).click();
		const otpInput = page.locator("#otp_token, .otp_token").first();
		await otpInput.waitFor({ state: "visible", timeout: 60_000 });
		await otpInput.click();
		await otpInput.pressSequentially(OTP_CODE, { delay: 50 });
		const validerBtn = page.getByRole("button", { name: /valider/i });
		await validerBtn.waitFor({ state: "visible", timeout: 30_000 });
		await validerBtn.click();
		await page.waitForLoadState("domcontentloaded");
		await passerBtn.waitFor({ state: "visible", timeout: 15_000 });
	}
	await shot(page, 2, "wallet-connecte");

	// 3. Ouvrir le dropdown "Passer l'évaluation"
	await passerBtn.click();

	// 4. Cliquer sur "Cas 4" (ouvre un nouvel onglet)
	const casLink = page.getByRole("link", { name: /^cas 4$/i }).first();
	await casLink.waitFor({ timeout: 10_000 });
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await shot(page, 3, "dropdown-ouvert");
	const [newPage] = await Promise.all([
		page.context().waitForEvent("page"),
		casLink.click(),
	]);
	await newPage.waitForLoadState("networkidle");

	// 5. Commencer
	const commencerBtn = newPage.getByRole("button", { name: "Commencer" });
	await commencerBtn.waitFor({ timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await shot(newPage, 4, "player-intro");
	await commencerBtn.click();

	const checkbox = (n: 0 | 1) => newPage.locator("input.form-check-input").nth(n);
	const btn = (name: string) => newPage.getByRole("button", { name });

	// Navigue vers la question suivante/précédente et attend que la question courante disparaisse
	const navigate = async (btnName: string) => {
		const handle = await newPage.locator("input.form-check-input").first().elementHandle();
		await btn(btnName).click();
		if (handle) {
			await handle.waitForElementState("hidden", { timeout: 10_000 }).catch(() => {});
		}
		await newPage.waitForLoadState("networkidle");
		await newPage.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
	};

	// 6. Cocher la 1ère réponse (Q1)
	await checkbox(0).waitFor({ state: "visible", timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await shot(newPage, 5, "evaluation-demarree");
	await checkbox(0).click();
	await shot(newPage, 6, "q1-reponse1-cochee");

	// 7. Suivant → Q2
	await navigate("Suivant");
	await shot(newPage, 7, "suivant-vers-q2");

	// 8. Précédent → Q1
	await navigate("Précédent");
	await shot(newPage, 8, "precedent-vers-q1");

	// 9. Cocher la 2ème réponse (Q1)
	await checkbox(1).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(1).click();
	await shot(newPage, 9, "q1-reponse2-cochee");

	// 10. Suivant → Q2
	await navigate("Suivant");
	await shot(newPage, 10, "suivant-vers-q2-bis");

	// 11. Cocher la 1ère réponse (Q2)
	await checkbox(0).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(0).click();
	await shot(newPage, 11, "q2-reponse1-cochee");

	// 12. Suivant → Q3
	await navigate("Suivant");
	await shot(newPage, 12, "suivant-vers-q3");

	// 13. Cocher la 1ère réponse (Q3)
	await checkbox(0).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(0).click();
	await shot(newPage, 13, "q3-reponse1-cochee");

	// 14. Suivant → Q4
	await navigate("Suivant");
	await shot(newPage, 14, "suivant-vers-q4");

	// 15. Précédent → Q3
	await navigate("Précédent");
	await shot(newPage, 15, "precedent-vers-q3");

	// 16. Cocher la 2ème réponse (Q3)
	await checkbox(1).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(1).click();
	await shot(newPage, 16, "q3-reponse2-cochee");

	// 17. Suivant → Q4
	await navigate("Suivant");
	await shot(newPage, 17, "suivant-vers-q4-bis");

	// 18. Cocher la 1ère réponse (Q4)
	await checkbox(0).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(0).click();
	await shot(newPage, 18, "q4-reponse1-cochee");

	// 19. Terminer → review (les checkboxes disparaissent)
	await navigate("Terminer");
	await shot(newPage, 19, "review");

	// 20. Retour → assessment Q4 (on attend l'apparition des checkboxes)
	await btn("Retour").click();
	await checkbox(0).waitFor({ state: "visible", timeout: 10_000 });
	await newPage.waitForLoadState("networkidle");
	await shot(newPage, 20, "retour-vers-q4");

	// 21. Cocher la 2ème réponse (Q4)
	await checkbox(1).waitFor({ state: "visible", timeout: 10_000 });
	await checkbox(1).click();
	await shot(newPage, 21, "q4-reponse2-cochee");

	// 22. Terminer → review à nouveau
	await navigate("Terminer");
	await shot(newPage, 22, "review-bis");

	// 23. Terminer → fin (page de résultats, pas de checkboxes)
	await btn("Terminer").click();
	await newPage.waitForLoadState("networkidle");
	await shot(newPage, 23, "evaluation-terminee");
});
