import type { Page } from "@playwright/test";

const GMAIL_INBOX = "https://mail.google.com/mail/u/0/#inbox";

/**
 * Supprime les N premiers mails de Procertif dans la boîte Gmail.
 * Nécessite que le storageState Gmail soit chargé (`.playwright-gmail-state.json`).
 */
export async function deleteFirstProcertifEmails(page: Page, count = 2): Promise<void> {
	for (let i = 0; i < count; i++) {
		await page.goto(GMAIL_INBOX, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(3000);

		await page.locator("tr.zA").first().waitFor({ timeout: 15_000 });

		const emailRow = page.locator("tr.zA").filter({ hasText: /procertif/i }).first();
		await emailRow.waitFor({ timeout: 10_000 });
		await page.waitForTimeout(2000);

		// Clic droit sur la ligne pour ouvrir le menu contextuel Gmail
		await emailRow.click({ button: "right" });
		await page.waitForTimeout(500);
		await page.getByRole("menuitem", { name: /supprimer|delete/i }).click();
		await page.waitForTimeout(4000);
	}
}
