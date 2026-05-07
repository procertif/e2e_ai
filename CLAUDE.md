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

Test specs live in `tests/`, named with the pattern `<num>-cas<n>-<type>-noai.spec.ts`. Current specs:
- `1-cas1-quiz-noai.spec.ts` — Quiz with full evaluation flow (3 questions, single page)
- `1-cas2-quiz-noai.spec.ts` — Quiz with incomplete questions
- `1-cas3-quiz-noai.spec.ts` — Per-activity evaluation (4 questions)
- `1-cas4-quiz-noai.spec.ts` — Multi-question navigation with Previous/Next buttons
- `2-cas1-jury-noai.spec.ts` — Jury review and assessment

All tests follow the same structure: set up a `screenshots/<cas-name>/` directory → authenticate via magic code (email + OTP `444444`) → navigate to feature → interact with UI → capture screenshots at key steps. Tests contain no assertions — they focus on workflow capture. Authentication logic is inlined in each test file (no shared helpers).

### Web Test Runner (`app/`)

A Node.js HTTP server (`app/server.js`) that provides a UI for running tests without the CLI:
- Lists test files via `GET /api/tests`
- Spawns Playwright as a child process via `POST /api/run/:filename`
- Streams output in real-time via Server-Sent Events at `GET /api/stream/:runId`
- Serves and manages screenshots (`/api/screenshots`, `/screenshots-img/:path`)
- Manages test groups via `GET/POST /api/groups` (persisted in `data/groups.json`)
- Claude chat via `POST /api/chat` (streaming SSE at `GET /api/chat-stream/:runId`)
- Saves chat conversations as JSON via `POST /api/chat-save` → `tests/prompt/<name>.json`

UI pages served from `app/`:
- `index.html` — Main test runner (queue, real-time output, session tracking)
- `screenshots.html` — Screenshot viewer with lightbox
- `groups.html` — Test group creation and management
- `chat.html` — Claude chat interface with global instructions and conversation save

### Data Files (`data/`)

Runtime data, gitignored:
- `groups.json` — Test grouping configuration
- `last-session.json` — Results of the last test session
- `run-history.json` — Historical timing metrics per test file

### Playwright Config (`playwright.config.ts`)

- Base URL: `https://app.procertif.dev`
- Browser: Chromium only
- `fullyParallel: false` — tests run sequentially
- `retries: 0`
- Screenshots on failure, traces on first retry
- `testDir: "tests"` — tous les `*.spec.ts` présents dans ce dossier sont exécutés

## Key Patterns

**Authentication**: Magic code login — fill email (`degertbenjamin3@gmail.com`), click "Log me", wait for Cloudflare Turnstile, then enter OTP `444444` into `#otp_token`.

**Timeouts**: Tests set `test.setTimeout(120000–240000)`. Element waits use explicit timeouts (10s–60s). After navigation, wait for network idle and for animations to finish:
```ts
await page.waitForFunction(() =>
  document.getAnimations().every(a => a.playState !== "running")
);
```

**Selectors**: Prefer role-based locators (`page.getByRole("button", { name: "..." })`); fall back to CSS selectors (`#otp_token`, `.form-check-input`) when needed.

**Screenshots**: Captured between every action with `await page.screenshot({ path: \`screenshots/cas-name/step.png\` })`. This is enforced as a global instruction in the chat IA.

**Chat IA system prompt**: The chat embeds two fixed system blocks (identity + working dirs) plus an optional user-defined instructions block stored in `localStorage`. Default instruction: `"Toujours prendre un screenshot entre chaque action dans les tests."` Conversations can be saved as JSON to `tests/prompt/` via the save modal.
