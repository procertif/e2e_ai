import type { Page } from "@playwright/test";

const ADMIN_EMAIL = "benjamin@procertif.com";
const OTP_CODE = "444444";
const BASE_URL = "http://app.procertif.dev";

async function loginIfNeeded(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`);
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(1500);

	const emailInput = page
		.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
		.first();
	const isLoginPage = await emailInput.isVisible().catch(() => false);
	if (!isLoginPage) return;

	await emailInput.fill(ADMIN_EMAIL);
	await page.getByRole("button", { name: /continuer|log me/i }).click();

	const otpInput = page.locator("#otp_token, .otp_token").first();
	await otpInput.waitFor({ state: "visible", timeout: 60_000 });
	await otpInput.click();
	await otpInput.pressSequentially(OTP_CODE, { delay: 50 });

	const validerBtn = page.getByRole("button", { name: /valider/i });
	await validerBtn.waitFor({ state: "attached", timeout: 30_000 });
	await page.waitForTimeout(1000);
	await validerBtn.click();
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(2000);
}

export async function sendInvitation(
	page: Page,
	certificationName: string,
	casLabel: string,
): Promise<void> {
	await loginIfNeeded(page);

	// Find certification link href on the certifications list page
	await page.goto(`${BASE_URL}/certifications`);
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(2000);

	const certLink = page.getByRole("link", { name: certificationName }).first();
	await certLink.waitFor({ state: "visible", timeout: 15_000 });
	const href = await certLink.getAttribute("href");
	if (!href) throw new Error(`Certification link not found: ${certificationName}`);

	// Navigate to the inscrits tab with ?tab=evaluation to auto-open first participant modal
	const certBase = href.replace(/\/$/, "");
	await page.goto(`${BASE_URL}${certBase}/certificate?tab=evaluation`);
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(3000);

	// Wait for the detail modal to be visible
	const modal = page.locator(".certificate_detail_modal, #certificate_detail_modal, [id*='certificate_detail']").first();
	await modal.waitFor({ state: "visible", timeout: 20_000 });
	await page.waitForTimeout(2000);

	// Find the assessment row whose title matches casLabel and click its invite button
	const rows = page.locator(".assessment_result_line");
	const count = await rows.count();

	for (let i = 0; i < count; i++) {
		const row = rows.nth(i);
		const title = await row.locator(".assessment_title").textContent().catch(() => "");
		if (title?.trim().toLowerCase().includes(casLabel.toLowerCase())) {
			const inviteBtn = row.locator(".assessment_quiz_invite .invite_btn");
			await inviteBtn.waitFor({ state: "visible", timeout: 10_000 });
			await inviteBtn.click();
			await page.waitForTimeout(5000);
			return;
		}
	}

	throw new Error(`Invite button not found for cas: ${casLabel}`);
}
