import { test } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots", "cas1-quiz-noai");
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

test("Ouvrir le quiz Cas 1 via Mon Coffre-Fort et passer l'évaluation", async ({ page }) => {
	test.setTimeout(120_000);

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

	// 4. Cliquer sur "Cas 1" (ouvre un nouvel onglet)
	const casLink = page.getByRole("link", { name: /^cas 1$/i }).first();
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

	// 6. Toutes les questions sont affichées sur une seule page
	await newPage.locator("input.form-check-input").first().waitFor({ state: "visible", timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await newPage.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "5-evaluation-demarree.png"), fullPage: true });
	await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "6-questions-affichees.png"), fullPage: true });

	const questionContainers = newPage.locator("div.container-fluid.bg-light.rounded");

	// Répondre aux questions 1, 2, 3
	for (let i = 0; i < 3; i++) {
		const checkbox = questionContainers.nth(i).locator("input.form-check-input").first();
		await checkbox.scrollIntoViewIfNeeded();
		await checkbox.click();
		await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${7 + i}-question-${i + 1}-repondue.png`), fullPage: true });
	}

	// Clic sur "Terminer"
	const terminerBtn = newPage.getByRole("button", { name: /terminer/i });
	await terminerBtn.waitFor({ timeout: 10_000 });
	await terminerBtn.click();
	await newPage.waitForLoadState("networkidle");
	await newPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "10-evaluation-terminee.png"), fullPage: true });
});
