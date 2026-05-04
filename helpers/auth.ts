import { Page, test as baseTest } from "@playwright/test";
import { ai } from "@zerostep/playwright";
import * as path from "path";

/**
 * Logs in via the magic code flow.
 * Steps: enter email → click "Log me" → wait for captcha → enter code → click "Valider"
 */
export async function login(
	page: Page,
	screenshotsDir: string,
	options: { email?: string; code?: string } = {}
): Promise<void> {
	const email = options.email ?? "benjamin@procertif.com";
	const code = options.code ?? "444444";

	await page.goto("/");
	await page.waitForLoadState("networkidle");

	// Enter email
	await ai(`Remplis le champ email avec "${email}"`, { page, test: baseTest });
	await page.screenshot({ path: path.join(screenshotsDir, "login-1-email.png"), fullPage: true });

	// Click "Log me"
	await ai('Clique sur le bouton "Log me"', { page, test: baseTest });

	// Wait for Cloudflare Turnstile to auto-complete.
	// Turnstile is passive — once done, the OTP input #otp_token appears.
	await page.waitForSelector("#otp_token", { timeout: 60_000, state: "visible" });
	await page.screenshot({ path: path.join(screenshotsDir, "login-2-apres-captcha.png"), fullPage: true });

	// Enter the magic code directly via the known selector
	await page.fill("#otp_token", code);

	// Click "Valider"
	await ai('Clique sur le bouton "Valider"', { page, test: baseTest });
	await page.waitForLoadState("networkidle");
}
