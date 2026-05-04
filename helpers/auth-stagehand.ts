import type { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import * as path from "path";

/**
 * Logs in via the magic code flow — Stagehand v3 version.
 *
 * In Stagehand v3, act() lives on the stagehand instance (not on page).
 * Navigation and screenshots use the V3 Page object from stagehand.context.activePage().
 */
export async function loginWithStagehand(
	stagehand: Stagehand,
	_page: Page, // conservé pour compatibilité mais on utilise activePage() dynamiquement
	screenshotsDir: string,
	options: { email?: string; code?: string } = {}
): Promise<void> {
	const email = options.email ?? "benjamin@procertif.com";
	const code = options.code ?? "444444";
	const getPage = () => stagehand.context.activePage()!;

	await getPage().goto("http://app.procertif.dev/");
	await getPage().waitForLoadState("networkidle", 30_000);

	await stagehand.act(`Remplis le champ email avec "${email}"`);
	await getPage().screenshot({ path: path.join(screenshotsDir, "login-1-email.png"), fullPage: true });

	await stagehand.act('Clique sur le bouton "Log me"');

	// Wait for Cloudflare Turnstile to auto-complete — the OTP input appears once done
	await getPage().waitForSelector("#otp_token", { timeout: 60_000, state: "visible" });
	await getPage().screenshot({ path: path.join(screenshotsDir, "login-2-apres-captcha.png"), fullPage: true });

	// Fill the OTP code via evaluate — V3 page has no fill(), only type() after a click
	await getPage().evaluate(
		({ selector, value }: { selector: string; value: string }) => {
			const input = document.querySelector(selector) as HTMLInputElement;
			if (input) {
				input.value = value;
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}
		},
		{ selector: "#otp_token", value: code }
	);

	await stagehand.act('Clique sur le bouton "Valider"');
	await getPage().waitForLoadState("networkidle", 30_000);
}
