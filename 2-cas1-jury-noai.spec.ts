import { test } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOTS_DIR = path.join(__dirname, "screenshots", "cas1-jury-noai");
const JURY_URL = "https://app.procertif.dev/certification/69dd020b6478d/jury/69ef77d3a5517/review";

test.beforeAll(() => {
	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
});

test.use({
	launchOptions: { args: ["--start-maximized"] },
	viewport: null,
});

const shot = (p: import("@playwright/test").Page, n: number, label: string) =>
	p.screenshot({ path: path.join(SCREENSHOTS_DIR, `${String(n).padStart(2, "0")}-${label}.png`), fullPage: true });

test("Cas 1 - Flow jury", async ({ page }) => {
	test.setTimeout(240_000);

	// 1. Naviguer directement sur la page jury
	await page.goto(JURY_URL, { waitUntil: "domcontentloaded" });

	// 2. Login Procertif - email
	await page.getByRole("textbox", { name: /email/i }).waitFor({ state: "visible", timeout: 15_000 });
	await page.waitForLoadState("networkidle");
	await shot(page, 1, "page-jury");
	await page.getByRole("textbox", { name: /email/i }).fill("degertbenjamin@gmail.com");
	await page.getByRole("button", { name: /continuer/i }).click();
	await shot(page, 2, "email-saisi");

	// 3. OTP
	const otpInput = page.locator("#otp_token, .otp_token").first();
	await otpInput.waitFor({ state: "visible", timeout: 60_000 });
	await otpInput.click();
	await otpInput.pressSequentially("444444", { delay: 50 });
	const validerBtn = page.getByRole("button", { name: /valider/i });
	await validerBtn.waitFor({ state: "visible", timeout: 30_000 });
	await shot(page, 3, "otp-saisi");
	await validerBtn.click();
	await page.waitForLoadState("networkidle");

	// 4. Démarrer l'évaluation
	const demarrerBtn = page.getByRole("button", { name: /Démarrer l'évaluation/i }).first();
	await demarrerBtn.waitFor({ timeout: 15_000 });
	await page.waitForLoadState("networkidle");
	await shot(page, 4, "apres-login");
	await demarrerBtn.click();

	// Le player s'exécute dans un iframe
	const playerFrame = page.frameLocator('iframe[src*="assess_launch"]');

	// 5. Consulter les évaluations — 1 bouton par quiz répondu (4 au total)
	const consultBtns = playerFrame.locator("a.section_result_url");
	await consultBtns.first().waitFor({ timeout: 15_000 });
	await page.waitForLoadState("networkidle");
	await shot(page, 5, "evaluation-demarree");

	const btnCount = await consultBtns.count();
	for (let i = 0; i < btnCount; i++) {
		const [evaluationTab] = await Promise.all([
			page.context().waitForEvent("page"),
			consultBtns.nth(i).click(),
		]);
		await evaluationTab.waitForLoadState("networkidle");
		await shot(evaluationTab, 6 + i, `evaluation-consultee-${i + 1}`);
		await evaluationTab.close();
		await page.bringToFront();
	}

	await page.waitForLoadState("networkidle");
	await shot(page, 10, "apres-consultation");

	// Terminer → review
	await playerFrame.getByRole("button", { name: /terminer/i }).click();
	await page.waitForLoadState("networkidle");
	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
	await shot(page, 11, "review");

	// Retour → assessment
	await playerFrame.getByRole("button", { name: /retour/i }).click();
	await page.waitForLoadState("networkidle");
	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
	await shot(page, 12, "retour-assessment");

	// Terminer → review à nouveau
	await playerFrame.getByRole("button", { name: /terminer/i }).click();
	await page.waitForLoadState("networkidle");
	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
	await shot(page, 13, "review-bis");

	// Terminer → fin
	await playerFrame.getByRole("button", { name: /terminer/i }).click();
	await page.waitForLoadState("networkidle");
	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
	await shot(page, 14, "evaluation-terminee");
});
