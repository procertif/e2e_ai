# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 2-cas1-jury-noai.spec.ts >> Cas 1 - Flow jury
- Location: tests/2-cas1-jury-noai.spec.ts:20:5

# Error details

```
TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /Démarrer l'évaluation/i }).first() to be visible

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e6]:
    - generic [ref=e9]:
      - button "Retour" [ref=e11] [cursor=pointer]:
        - img [ref=e12]
        - text: Retour
      - generic [ref=e14]:
        - generic [ref=e16]:
          - heading "Premier Badge Benjamin" [level=3] [ref=e17]:
            - link "Premier Badge Benjamin" [ref=e18] [cursor=pointer]:
              - /url: /certification/69dd020b6478d/jury
          - heading "J Cas 1" [level=5] [ref=e19]:
            - img [ref=e20]
            - text: J Cas 1
          - generic [ref=e22]: Procertif
        - generic [ref=e24]:
          - generic [ref=e25]:
            - generic [ref=e26]: Membres du jury
            - generic [ref=e27]:
              - img "avatar" [ref=e29]
              - button "Visualiser la liste des jurés" [ref=e30] [cursor=pointer]:
                - img [ref=e31]
                - text: Visualiser la liste des jurés
          - button "Préparer l'évaluation" [ref=e35] [cursor=pointer]:
            - img [ref=e36]
            - text: Préparer l'évaluation
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]:
            - img [ref=e42]
            - generic [ref=e44]: État du jury
          - generic [ref=e45]: En cours
        - generic [ref=e48]:
          - button "Prévisualiser le PV" [ref=e49] [cursor=pointer]:
            - img [ref=e50]
            - text: Prévisualiser le PV
          - button "Clôturer l'évaluation" [ref=e52] [cursor=pointer]:
            - img [ref=e53]
            - text: Clôturer l'évaluation
    - paragraph [ref=e60]:
      - text: Bienvenue dans votre espace d'évaluation.
      - text: Vous pouvez ici filtrer et rechercher les candidats à évaluer. Bonne évaluation !
    - generic [ref=e67]:
      - textbox "Rechercher..." [ref=e69]
      - button [ref=e70] [cursor=pointer]:
        - img [ref=e71]
    - generic [ref=e75]:
      - button "Tous" [ref=e77] [cursor=pointer]
      - button "0 à traiter" [ref=e79] [cursor=pointer]
      - button "0 en cours" [ref=e81] [cursor=pointer]
      - button "1 évalué" [ref=e83] [cursor=pointer]
      - button "0 ajourné" [ref=e85] [cursor=pointer]
    - generic [ref=e89]:
      - heading "#1" [level=4] [ref=e91]
      - generic [ref=e93]:
        - img "avatar" [ref=e96]
        - generic [ref=e98]:
          - link "Benjamin DEGERT" [ref=e99] [cursor=pointer]:
            - /url: /users/6970b1fdbaa6e
          - generic [ref=e100]:
            - generic "degertbenjamin3@gmail.com" [ref=e101]
            - button [ref=e102] [cursor=pointer]:
              - img [ref=e103]
          - generic [ref=e105]: Procertif
      - generic [ref=e107]: "Score : -/100"
      - generic [ref=e108]:
        - button [ref=e109] [cursor=pointer]:
          - img [ref=e110]
        - group [ref=e112]:
          - button "Evaluation réalisée" [ref=e113] [cursor=pointer]:
            - img [ref=e114]
            - text: Evaluation réalisée
          - button "Evaluation réalisée" [ref=e116] [cursor=pointer]:
            - generic [ref=e117]:
              - img [ref=e118]
              - text: Evaluation réalisée
  - region "Symfony Web Debug Toolbar" [ref=e120]:
    - generic [ref=e123]:
      - link "200 @ certification_jury_session_review" [ref=e125] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=request
        - generic [ref=e126]:
          - generic [ref=e127]: "200"
          - generic [ref=e128]: "@"
          - generic [ref=e129]: certification_jury_session_review
      - link "154 ms" [ref=e131] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=time
        - generic [ref=e132]:
          - generic [ref=e133]: "154"
          - generic [ref=e134]: ms
      - link "12.0 MiB" [ref=e136] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=time
        - generic [ref=e137]:
          - generic [ref=e138]: "12.0"
          - generic [ref=e139]: MiB
      - generic [ref=e141] [cursor=pointer]:
        - img [ref=e142]
        - generic [ref=e146]: "7"
      - link "Logger 25" [ref=e148] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=logger
        - generic [ref=e149]:
          - img "Logger" [ref=e150]
          - generic [ref=e154]: "25"
      - link "Cache 5 in 0.10 ms" [ref=e156] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=cache
        - generic [ref=e157]:
          - img "Cache" [ref=e158]
          - generic [ref=e163]: "5"
          - generic [ref=e164]: in 0.10 ms
      - link "Security degertbenjamin@gmail.com" [ref=e166] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=security
        - generic [ref=e167]:
          - img "Security" [ref=e168]
          - generic [ref=e172]: degertbenjamin@gmail.com
      - link "Twig 2 ms" [ref=e174] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=twig
        - generic [ref=e175]:
          - img "Twig" [ref=e176]
          - generic [ref=e180]: "2"
          - generic [ref=e181]: ms
      - link "5 in 3.15 ms" [ref=e183] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=db
        - generic [ref=e184]:
          - img [ref=e185]
          - generic [ref=e190]: "5"
          - generic [ref=e191]: in 3.15 ms
      - link "Vite" [ref=e193] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=pentatrion_vite.vite_collector
        - generic [ref=e194]:
          - img [ref=e195]
          - generic [ref=e199]: Vite
      - link "Symfony 7.4.8" [ref=e201] [cursor=pointer]:
        - /url: https://app.procertif.dev/_profiler/e128e0?panel=config
        - generic [ref=e202]:
          - img "Symfony" [ref=e204]
          - generic [ref=e206]: 7.4.8
      - button [expanded] [ref=e207] [cursor=pointer]:
        - generic "Close Toolbar" [ref=e208]:
          - img [ref=e209]
```

# Test source

```ts
  1   | import { test } from "@playwright/test";
  2   | import * as path from "path";
  3   | import * as fs from "fs";
  4   | 
  5   | const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots", "cas1-jury-noai");
  6   | const JURY_URL = "https://app.procertif.dev/certification/69dd020b6478d/jury/69ef77d3a5517/review";
  7   | 
  8   | test.beforeAll(() => {
  9   | 	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  10  | });
  11  | 
  12  | test.use({
  13  | 	launchOptions: { args: ["--start-maximized"] },
  14  | 	viewport: null,
  15  | });
  16  | 
  17  | const shot = (p: import("@playwright/test").Page, n: number, label: string) =>
  18  | 	p.screenshot({ path: path.join(SCREENSHOTS_DIR, `${String(n).padStart(2, "0")}-${label}.png`), fullPage: true });
  19  | 
  20  | test("Cas 1 - Flow jury", async ({ page }) => {
  21  | 	test.setTimeout(240_000);
  22  | 
  23  | 	// 1. Naviguer directement sur la page jury
  24  | 	await page.goto(JURY_URL, { waitUntil: "domcontentloaded" });
  25  | 
  26  | 	// 2. Login Procertif - email
  27  | 	await page.getByRole("textbox", { name: /email/i }).waitFor({ state: "visible", timeout: 15_000 });
  28  | 	await page.waitForLoadState("networkidle");
  29  | 	await shot(page, 1, "page-jury");
  30  | 	await page.getByRole("textbox", { name: /email/i }).fill("degertbenjamin@gmail.com");
  31  | 	await page.getByRole("button", { name: /continuer/i }).click();
  32  | 	await shot(page, 2, "email-saisi");
  33  | 
  34  | 	// 3. OTP
  35  | 	const otpInput = page.locator("#otp_token, .otp_token").first();
  36  | 	await otpInput.waitFor({ state: "visible", timeout: 60_000 });
  37  | 	await otpInput.click();
  38  | 	await otpInput.pressSequentially("444444", { delay: 50 });
  39  | 	const validerBtn = page.getByRole("button", { name: /valider/i });
  40  | 	await validerBtn.waitFor({ state: "visible", timeout: 30_000 });
  41  | 	await shot(page, 3, "otp-saisi");
  42  | 	await validerBtn.click();
  43  | 	await page.waitForLoadState("networkidle");
  44  | 
  45  | 	// 4. Démarrer l'évaluation
  46  | 	const demarrerBtn = page.getByRole("button", { name: /Démarrer l'évaluation/i }).first();
> 47  | 	await demarrerBtn.waitFor({ timeout: 15_000 });
      |                    ^ TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
  48  | 	await page.waitForLoadState("networkidle");
  49  | 	await shot(page, 4, "apres-login");
  50  | 	await demarrerBtn.click();
  51  | 
  52  | 	// Le player s'exécute dans un iframe
  53  | 	const playerFrame = page.frameLocator('iframe[src*="assess_launch"]');
  54  | 
  55  | 	// 5. Consulter les évaluations — 1 bouton par quiz répondu (4 au total)
  56  | 	const consultBtns = playerFrame.locator("a.section_result_url");
  57  | 	await consultBtns.first().waitFor({ timeout: 15_000 });
  58  | 	await page.waitForLoadState("networkidle");
  59  | 	await shot(page, 5, "evaluation-demarree");
  60  | 
  61  | 	const btnCount = await consultBtns.count();
  62  | 	for (let i = 0; i < btnCount; i++) {
  63  | 		const [evaluationTab] = await Promise.all([
  64  | 			page.context().waitForEvent("page"),
  65  | 			consultBtns.nth(i).click(),
  66  | 		]);
  67  | 		await evaluationTab.waitForLoadState("networkidle");
  68  | 		await shot(evaluationTab, 6 + i, `evaluation-consultee-${i + 1}`);
  69  | 		await evaluationTab.close();
  70  | 		await page.bringToFront();
  71  | 	}
  72  | 
  73  | 	await page.waitForLoadState("networkidle");
  74  | 	await shot(page, 10, "apres-consultation");
  75  | 
  76  | 	// Terminer → review
  77  | 	await playerFrame.getByRole("button", { name: /terminer/i }).click();
  78  | 	await page.waitForLoadState("networkidle");
  79  | 	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  80  | 	await shot(page, 11, "review");
  81  | 
  82  | 	// Retour → assessment
  83  | 	await playerFrame.getByRole("button", { name: /retour/i }).click();
  84  | 	await page.waitForLoadState("networkidle");
  85  | 	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  86  | 	await shot(page, 12, "retour-assessment");
  87  | 
  88  | 	// Terminer → review à nouveau
  89  | 	await playerFrame.getByRole("button", { name: /terminer/i }).click();
  90  | 	await page.waitForLoadState("networkidle");
  91  | 	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  92  | 	await shot(page, 13, "review-bis");
  93  | 
  94  | 	// Terminer → fin
  95  | 	await playerFrame.getByRole("button", { name: /terminer/i }).click();
  96  | 	await page.waitForLoadState("networkidle");
  97  | 	await playerFrame.locator("text=Chargement").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  98  | 	await shot(page, 14, "evaluation-terminee");
  99  | });
  100 | 
```