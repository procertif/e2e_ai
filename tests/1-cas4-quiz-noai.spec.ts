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

const shot = (p: import("@playwright/test").Page, n: number, label: string) =>
	p.screenshot({ path: path.join(SCREENSHOTS_DIR, `${String(n).padStart(2, "0")}-${label}.png`), fullPage: true });

test("Cas 4 - Navigation quiz avec Précédent/Suivant", async ({ page }) => {
	test.setTimeout(240_000);

	// ── 1. Naviguer vers /mywallet ──────────────────────────────────────────
	await page.goto(`${BASE_URL}/mywallet`, { waitUntil: "domcontentloaded" });

	const passerBtn = page.getByRole("button", { name: /Passer l'évaluation/i }).first();
	const emailInput = page
		.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
		.first();

	await Promise.race([
		emailInput.waitFor({ state: "visible" }),
		passerBtn.waitFor({ state: "visible" }),
	]);
	await shot(page, 1, "mywallet");

	// ── 2. Connexion si nécessaire ──────────────────────────────────────────
	if (await emailInput.isVisible()) {
		await emailInput.fill(EMAIL);
		await page.getByRole("button", { name: /continuer|log me/i }).click();
		await shot(page, 2, "email-saisi");

		// Attendre que le champ OTP apparaisse
		const otpInput = page.locator("#otp_token, .otp_token").first();
		await otpInput.waitFor({ state: "visible", timeout: 60_000 });
		await shot(page, 3, "otp-visible");

		// Rentrer le code 444444
		await otpInput.click();
		await otpInput.pressSequentially(OTP_CODE, { delay: 50 });
		await shot(page, 4, "otp-saisi");

		const validerBtn = page.getByRole("button", { name: /valider/i });
		await validerBtn.waitFor({ state: "visible", timeout: 30_000 });
		await validerBtn.click();
		await page.waitForLoadState("domcontentloaded");
		await passerBtn.waitFor({ state: "visible", timeout: 15_000 });
	} else {
		// Déjà connecté — on prend quand même les screenshots numérotés
		await shot(page, 2, "email-saisi");
		await shot(page, 3, "otp-visible");
		await shot(page, 4, "otp-saisi");
	}

	await shot(page, 5, "wallet-connecte");

	// ── 3. Ouvrir le dropdown "Passer l'évaluation" ──────────────────────
	await passerBtn.click();

	// ── 4. Cliquer sur "Cas 4" (ouvre un nouvel onglet) ──────────────────
	const casLink = page.getByRole("link", { name: /^cas 4$/i }).first();
	await casLink.waitFor({ timeout: 10_000 });
	await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await shot(page, 6, "dropdown-ouvert");

	const [newPage] = await Promise.all([
		page.context().waitForEvent("page"),
		casLink.click(),
	]);
	await newPage.waitForLoadState("networkidle");

	// ── 5. Clic sur "Commencer" ───────────────────────────────────────────
	const commencerBtn = newPage.getByRole("button", { name: "Commencer" });
	await commencerBtn.waitFor({ timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await shot(newPage, 7, "player-intro");
	await commencerBtn.click();

	// Attendre la première question
	await newPage.locator("input.form-check-input").first().waitFor({ state: "visible", timeout: 15_000 });
	await newPage.waitForLoadState("networkidle");
	await newPage.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await shot(newPage, 8, "evaluation-demarree");

	// ── Helpers locaux ───────────────────────────────────────────────────
	const waitForNextQuestion = async (oldHandle: import("@playwright/test").ElementHandle | null) => {
		await oldHandle?.waitForElementState("hidden", { timeout: 10_000 }).catch(() => {});
		await newPage.waitForLoadState("networkidle");
		await newPage.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	};

	const cocherReponse = async (index: number) => {
		const checkbox = newPage.locator("input.form-check-input").nth(index);
		await checkbox.waitFor({ state: "visible", timeout: 15_000 });
		await checkbox.scrollIntoViewIfNeeded();
		await checkbox.click();
	};

	const cliquerSuivant = async () => {
		const btn = newPage.getByRole("button", { name: "Suivant" });
		await btn.waitFor({ timeout: 10_000 });
		const handle = await newPage.locator("input.form-check-input").first().elementHandle();
		await btn.click();
		await waitForNextQuestion(handle);
	};

	const cliquerPrecedent = async () => {
		const btn = newPage.getByRole("button", { name: "Précédent" });
		await btn.waitFor({ timeout: 10_000 });
		const handle = await newPage.locator("input.form-check-input").first().elementHandle();
		await btn.click();
		await waitForNextQuestion(handle);
	};

	const cliquerTerminer = async () => {
		const btn = newPage.getByRole("button", { name: "Terminer" });
		await btn.waitFor({ timeout: 10_000 });
		await btn.click();
		await newPage.waitForLoadState("networkidle");
		await newPage.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	};

	// ── Q1 : Cocher la 1ère réponse ──────────────────────────────────────
	await cocherReponse(0);
	await shot(newPage, 9, "q1-reponse-1-cochee");

	// ── Cliquer Suivant ───────────────────────────────────────────────────
	await cliquerSuivant();
	await shot(newPage, 10, "q2-apres-suivant");

	// ── Cliquer Précédent ─────────────────────────────────────────────────
	await cliquerPrecedent();
	await shot(newPage, 11, "q1-apres-precedent");

	// ── Q1 : Cocher la 2ème réponse ──────────────────────────────────────
	await cocherReponse(1);
	await shot(newPage, 12, "q1-reponse-2-cochee");

	// ── Cliquer Suivant ───────────────────────────────────────────────────
	await cliquerSuivant();
	await shot(newPage, 13, "q2-apres-suivant-bis");

	// ── Q2 : Cocher la 1ère réponse ──────────────────────────────────────
	await cocherReponse(0);
	await shot(newPage, 14, "q2-reponse-1-cochee");

	// ── Cliquer Suivant ───────────────────────────────────────────────────
	await cliquerSuivant();
	await shot(newPage, 15, "q3-apres-suivant");

	// ── Q3 : Cocher la 1ère réponse ──────────────────────────────────────
	await cocherReponse(0);
	await shot(newPage, 16, "q3-reponse-1-cochee");

	// ── Cliquer Suivant ───────────────────────────────────────────────────
	await cliquerSuivant();
	await shot(newPage, 17, "q4-apres-suivant");

	// ── Cliquer Précédent ─────────────────────────────────────────────────
	await cliquerPrecedent();
	await shot(newPage, 18, "q3-apres-precedent");

	// ── Q3 : Cocher la 2ème réponse ──────────────────────────────────────
	await cocherReponse(1);
	await shot(newPage, 19, "q3-reponse-2-cochee");

	// ── Cliquer Suivant ───────────────────────────────────────────────────
	await cliquerSuivant();
	await shot(newPage, 20, "q4-apres-suivant-bis");

	// ── Q4 : Cocher la 1ère réponse ──────────────────────────────────────
	await cocherReponse(0);
	await shot(newPage, 21, "q4-reponse-1-cochee");

	// ── Cliquer Terminer (→ Review) ───────────────────────────────────────
	await cliquerTerminer();
	await shot(newPage, 22, "review");

	// ── Cliquer Retour (→ retour à l'évaluation) ─────────────────────────
	const retourBtn = newPage.getByRole("button", { name: "Retour" });
	await retourBtn.waitFor({ timeout: 10_000 });
	await retourBtn.click();
	await newPage.waitForLoadState("networkidle");
	await newPage.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
	await shot(newPage, 23, "retour-evaluation");

	// ── Cocher la 2ème réponse (sur la question courante après retour) ────
	await cocherReponse(1);
	await shot(newPage, 24, "reponse-2-cochee-apres-retour");

	// ── Cliquer Terminer (→ Review) ───────────────────────────────────────
	await cliquerTerminer();
	await shot(newPage, 25, "review-bis");

	// ── Cliquer Terminer (→ confirmation finale) ──────────────────────────
	await cliquerTerminer();
	await shot(newPage, 26, "evaluation-terminee");
});
