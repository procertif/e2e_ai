# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Playwright-based end-to-end test suite for the Procertif certification platform (`https://app.procertif.dev`). Tests are written in TypeScript and cover certification evaluation flows (quizzes) and jury review workflows. The UI and tests are in French.

## Commands

```bash
# Run all tests (Playwright CLI)
npm test

# Run a specific test file
npx playwright test 1-cas1-quiz-noai.spec.ts

# Start the web-based test runner UI (port 3333)
npm run server
```

No linting or build step is configured.

## Architecture

### Test Files

Test specs live in `tests/`, named with the pattern `<num>-cas<n>-<type>-(ai|noai).spec.ts`. Current specs:
- `1-cas1-quiz-noai.spec.ts` — Quiz with full evaluation flow
- `1-cas2-quiz-noai.spec.ts` — Quiz with incomplete questions
- `1-cas3-quiz-noai.spec.ts` — Per-activity evaluation (4 questions)
- `1-cas4-quiz-noai.spec.ts` — Multi-question navigation
- `2-cas1-jury-noai.spec.ts` — Jury review and assessment

All tests follow the same structure: set up a `screenshots/<cas-name>/` directory → authenticate via magic code (email + OTP) → navigate to feature → interact with UI → capture screenshots at key steps. Tests contain no assertions — they focus on workflow capture.

### Helpers (`helpers/`)

- `auth.ts` — Login flow using Playwright locators; also has a variant using `@zerostep/playwright` for AI-assisted form filling
- `auth-stagehand.ts` — Alternative login using Browserbase Stagehand v3 AI actions
- `send-invitation.ts` — Sends a certification invitation through the platform UI
- `gmail-cleanup.ts` — Deletes emails from Gmail (used for test cleanup)

### Web Test Runner (`app_test/`)

A Node.js HTTP server (`server.js`) that provides a UI for running tests without the CLI:
- Lists test files via `/api/tests`
- Spawns Playwright as a child process via `/api/run/:filename`
- Streams output in real-time via Server-Sent Events at `/api/stream/:runId`
- Serves and manages screenshots (`/api/screenshots`, `/screenshots-img/:path`)
- Supports injecting an OpenAI API key at runtime (for AI-assisted test variants)

### Playwright Config (`playwright.config.ts`)

- Base URL: `https://app.procertif.dev`
- Browser: Chromium only
- `fullyParallel: false` — tests run sequentially
- `retries: 0`
- Screenshots on failure, traces on first retry
- `testDir: "tests"` — tous les `*.spec.ts` présents dans ce dossier sont exécutés

## Key Patterns

**Authentication**: Magic code login — fill email, click "Log me", wait for Cloudflare Turnstile, then enter OTP from `#otp_token`.

**Timeouts**: Tests set `test.setTimeout(120000–240000)`. Element waits use explicit timeouts (10s–60s). After navigation, wait for network idle and for animations to finish:
```ts
await page.waitForFunction(() =>
  document.getAnimations().every(a => a.playState !== "running")
);
```

**Selectors**: Prefer role-based locators (`page.getByRole("button", { name: "..." })`); fall back to CSS selectors (`#otp_token`, `.form-check-input`) when needed.

**Screenshots**: Captured at each significant step with `await page.screenshot({ path: \`screenshots/cas-name/step.png\` })`.
