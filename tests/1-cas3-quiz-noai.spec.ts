import { test } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots", "cas3-quiz-noai");
const BASE_URL = process.env.BASE_URL || "https://app.procertif.dev";
const EMAIL = "degertbenjamin3@gmail.com";
const OTP_CODE = process.env.TEST_OTP || "444444";

test.beforeAll(() => {
	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
});

test.use({
	launchOptions: { args: ["--start-maximized"] },
	viewport: null,
});

async function repondreEtNaviguer(
	newPage: import("@playwright/test").Page,
	bouton: "Suivant" | "Terminer",
	screenshotsDir: string,
	screenshotIndex: number,
) {
	const checkbox = newPage.locator("input.form-check-input").first();
	await checkbox.waitFor({ state: "visible", timeout: 15_000 });
	await checkbox.scrollIntoViewIfNeeded();
	// Capture l'élément DOM courant pour détecter la transition vers la question suivante
	const checkboxHandle = await checkbox.elementHandle();
	await checkbox.click();
	await newPage.screenshot({
		path: path.join(screenshotsDir, `${screenshotIndex}-reponse-cochee.png`),
		fullPage: true,
	});

	const btn = newPage.getByRole("button", { name: bouton });
	await btn.waitFor({ timeout: 10_000 });
	await btn.click();
	// Attend que l'élément courant disparaisse (React l'a démonté = question suivante rendue)
	await checkboxHandle?.waitForElementState("hidden", { timeout: 10_000 }).catch(() => {});
	await newPage.waitForLoadState("networkidle");
	await newPage.screenshot({
		path: path.join(screenshotsDir, `${screenshotIndex + 1}-${bouton.toLowerCase()}-clique.png`),
		fullPage: true,
	});
}

test("Cas 3 - Évaluation per activity (4 questions)", async ({ page }) => {
	test.setTimeout(180_000);

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
	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "1-mywallet.png"), fullPage: true });

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
	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "2-wallet-connecte.png"), fullPage: true });

	// 3. Ouvrir le dropdown "Passer l'évaluation"
	await passerBtn.click();

	// 4. Cliquer sur "Cas 3" (ouvre un nouvel onglet)
	const casLink = page.getByRole("link", { name: /^cas 3$/i }).first();
	await casLink.waitFor({ timeout: 10_000 });
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "3-dropdown-ouvert.png"), fullPage: true });
	const [newPage] = await Promise.all([
		page.context().waitForEvent("page"),
		casLink.click(),
	]);
	await newPage.waitForLoadState("networkidle");

	// 5. Clic sur "Commencer"
	const commencerBtn = newPage.getByRole("button", { name: "Commencer" });
	await commencerBtn.waitFor({ timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "4-player-intro.png"), fullPage: true });
	await commencerBtn.click();

	await newPage.locator("input.form-check-input").first().waitFor({ state: "visible", timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "5-evaluation-demarree.png"), fullPage: true });

	// Q1, Q2, Q3 → répondre + Suivant ; Q4 → répondre + Terminer
	await repondreEtNaviguer(newPage, "Suivant", SCREENSHOTS_DIR, 6);
	await repondreEtNaviguer(newPage, "Suivant", SCREENSHOTS_DIR, 8);
	await repondreEtNaviguer(newPage, "Suivant", SCREENSHOTS_DIR, 10);
	await repondreEtNaviguer(newPage, "Terminer", SCREENSHOTS_DIR, 12);
});
