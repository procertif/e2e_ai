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

test("Cas 4 - Navigation multi-questions avec retours", async ({ page }) => {
	test.setTimeout(240_000);

	let stepNum = 1;
	const ssMain = async (name: string) => {
		await page.screenshot({
			path: path.join(SCREENSHOTS_DIR, `${stepNum++}-${name}.png`),
			fullPage: true,
		});
	};

	// 1. Naviguer vers /mywallet
	await page.goto(`${BASE_URL}/mywallet`, { waitUntil: "domcontentloaded" });
	await ssMain("mywallet"); // 1

	// 2. Login si nécessaire
	const passerBtn = page.getByRole("button", { name: /Passer l'évaluation/i }).first();
	const emailInput = page
		.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
		.first();
	await Promise.race([
		emailInput.waitFor({ state: "visible" }),
		passerBtn.waitFor({ state: "visible" }),
	]);

	if (await emailInput.isVisible()) {
		await emailInput.fill(EMAIL);
		await page.getByRole("button", { name: /continuer|log me/i }).click();
		await ssMain("email-soumis"); // 2

		// 3. Attendre que le champ OTP apparaisse
		const otpInput = page.locator("#otp_token, .otp_token").first();
		await otpInput.waitFor({ state: "visible", timeout: 60_000 });
		await ssMain("champ-code-apparu"); // 3

		// 4. Rentrer le code
		await otpInput.click();
		await otpInput.pressSequentially(OTP_CODE, { delay: 50 });
		await ssMain("code-rentre"); // 4

		const validerBtn = page.getByRole("button", { name: /valider/i });
		await validerBtn.waitFor({ state: "visible", timeout: 30_000 });
		await validerBtn.click();
		await page.waitForLoadState("domcontentloaded");
		await passerBtn.waitFor({ state: "visible", timeout: 15_000 });
	}

	// 5. Cliquer sur "Passer l'évaluation"
	await passerBtn.click();
	await ssMain("passer-evaluation-clique"); // 5

	// 6. Cliquer sur "Cas 4" (ouvre un nouvel onglet)
	const casLink = page.getByRole("link", { name: /^cas 4$/i }).first();
	await casLink.waitFor({ timeout: 10_000 });
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	const [newPage] = await Promise.all([
		page.context().waitForEvent("page"),
		casLink.click(),
	]);
	await newPage.waitForLoadState("networkidle");
	await newPage.screenshot({
		path: path.join(SCREENSHOTS_DIR, `${stepNum++}-cas4-clique.png`),
		fullPage: true,
	}); // 6

	// Helpers pour le nouvel onglet
	const ss = async (name: string) => {
		await newPage.screenshot({
			path: path.join(SCREENSHOTS_DIR, `${stepNum++}-${name}.png`),
			fullPage: true,
		});
	};

	// Cocher la N-ième réponse (1 = première, 2 = deuxième)
	const cocher = async (index: number) => {
		const cb = newPage.locator("input.form-check-input").nth(index - 1);
		await cb.waitFor({ state: "visible", timeout: 15_000 });
		await cb.scrollIntoViewIfNeeded();
		await cb.click();
	};

	// Cliquer un bouton de navigation et attendre la transition de question
	const clickNav = async (label: string) => {
		const btn = newPage.getByRole("button", { name: new RegExp(label, "i") }).first();
		await btn.waitFor({ timeout: 10_000 });
		const cbHandle = await newPage.locator("input.form-check-input").first().elementHandle();
		await btn.click();
		await cbHandle?.waitForElementState("hidden", { timeout: 10_000 }).catch(() => {});
		await newPage.waitForLoadState("networkidle");
		await newPage.waitForFunction(() =>
			document.getAnimations().every((a) => a.playState !== "running"),
		);
	};

	// 7. Cliquer sur "Commencer"
	const commencerBtn = newPage.getByRole("button", { name: "Commencer" });
	await commencerBtn.waitFor({ timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await commencerBtn.click();
	await newPage.locator("input.form-check-input").first().waitFor({ state: "visible", timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await ss("commencer-clique"); // 7

	// ── Q1 ──────────────────────────────────────────────────────────────────────

	// 8. Cocher la 1ère réponse (Q1)
	await cocher(1);
	await ss("q1-reponse1-cochee"); // 8

	// 9. Cliquer sur Suivant → Q2
	await clickNav("Suivant");
	await ss("q1-suivant-clique"); // 9

	// 10. Cliquer sur Précédent → retour Q1
	await clickNav("Précédent");
	await ss("q2-precedent-clique"); // 10

	// 11. Cocher la 2ème réponse (Q1)
	await cocher(2);
	await ss("q1-reponse2-cochee"); // 11

	// 12. Cliquer sur Suivant → Q2
	await clickNav("Suivant");
	await ss("q1-suivant2-clique"); // 12

	// ── Q2 ──────────────────────────────────────────────────────────────────────

	// 13. Cocher la 1ère réponse (Q2)
	await cocher(1);
	await ss("q2-reponse1-cochee"); // 13

	// 14. Cliquer sur Suivant → Q3
	await clickNav("Suivant");
	await ss("q2-suivant-clique"); // 14

	// ── Q3 ──────────────────────────────────────────────────────────────────────

	// 15. Cocher la 1ère réponse (Q3)
	await cocher(1);
	await ss("q3-reponse1-cochee"); // 15

	// 16. Cliquer sur Suivant → Q4
	await clickNav("Suivant");
	await ss("q3-suivant-clique"); // 16

	// 17. Cliquer sur Précédent → retour Q3
	await clickNav("Précédent");
	await ss("q4-precedent-clique"); // 17

	// 18. Cocher la 2ème réponse (Q3)
	await cocher(2);
	await ss("q3-reponse2-cochee"); // 18

	// 19. Cliquer sur Suivant → Q4
	await clickNav("Suivant");
	await ss("q3-suivant2-clique"); // 19

	// ── Q4 ──────────────────────────────────────────────────────────────────────

	// 20. Cocher la 1ère réponse (Q4)
	await cocher(1);
	await ss("q4-reponse1-cochee"); // 20

	// 21. Cliquer sur Terminer
	const terminerBtn = newPage.getByRole("button", { name: /terminer/i }).first();
	await terminerBtn.waitFor({ timeout: 10_000 });
	await terminerBtn.click();
	await newPage.waitForLoadState("networkidle");
	await ss("terminer1-clique"); // 21

	// 22. Cliquer sur Retour
	const retourBtn = newPage.getByRole("button", { name: /retour/i }).first();
	await retourBtn.waitFor({ timeout: 10_000 });
	await retourBtn.click();
	await newPage.waitForLoadState("networkidle");
	await newPage.waitForFunction(() =>
		document.getAnimations().every((a) => a.playState !== "running"),
	);
	await ss("retour-clique"); // 22

	// 23. Cocher la 2ème réponse
	await cocher(2);
	await ss("reponse2-cochee-apres-retour"); // 23

	// 24. Cliquer sur Terminer
	const terminerBtn2 = newPage.getByRole("button", { name: /terminer/i }).first();
	await terminerBtn2.waitFor({ timeout: 10_000 });
	await terminerBtn2.click();
	await newPage.waitForLoadState("networkidle");
	await ss("terminer2-clique"); // 24

	// 25. Cliquer sur Terminer (confirmation)
	const terminerBtn3 = newPage.getByRole("button", { name: /terminer/i }).first();
	await terminerBtn3.waitFor({ timeout: 10_000 });
	await terminerBtn3.click();
	await newPage.waitForLoadState("networkidle");
	await ss("terminer3-clique"); // 25
});
