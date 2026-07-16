import * as path from "path";
import * as fs from "fs";
import type { Page } from "@playwright/test";

// Single source of truth for the screenshots directory used by generated
// specs. Anchored on process.cwd() (Playwright always runs with cwd = repo
// root, see backend/server.js) rather than a per-file relative "__dirname/.."
// computation — that math depended on how deep the spec file lives and had
// silently broken before (screenshots landed in data/versioned/screenshots
// instead of data/screenshots). Creates the folder if missing so callers
// never need their own fs.mkdirSync/beforeAll boilerplate.
export function getScreenshotDir(subfolder: string): string {
	const dir = path.resolve(process.cwd(), "data", "screenshots", subfolder);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

// Numbered, zero-padded screenshot helper bound to a test's screenshot dir —
// avoids every spec redefining the same closure. padLength defaults to 2
// (up to 99 shots); pass 3 for specs with 100+ steps.
export function createShot(dir: string, padLength: 2 | 3 = 2) {
	return (page: Page, n: number, label: string) =>
		page.screenshot({ path: path.join(dir, `${String(n).padStart(padLength, "0")}-${label}.png`), fullPage: true });
}

// Key/value variables of the target Environment (configured in the Environments
// page), injected by backend/server.js as JSON in the E2E_ENV_VARS env var when
// the test process is spawned. Tests must never hardcode environment-specific
// values (tokens, OTP codes, credentials, feature flags…) — always go through
// this function so the same spec runs unmodified against any environment.
let cachedVars: Record<string, string> | null = null;

export function getEnvironmentVariable(key: string): string {
	if (cachedVars === null) {
		try {
			cachedVars = JSON.parse(process.env.E2E_ENV_VARS || "{}");
		} catch {
			cachedVars = {};
		}
	}
	const value = cachedVars[key];
	if (value === undefined) {
		throw new Error(`Environment variable "${key}" is not defined on the selected environment. Add it on the Environments page.`);
	}
	return value;
}

// URL of the target Environment (configured in the Environments page), set by
// backend/server.js as the BASE_URL env var when the test process is spawned.
// Tests must never hardcode a base URL — always go through this function so
// the same spec runs unmodified against any environment.
export function getEnvironmentBaseUrl(): string {
	const value = process.env.BASE_URL;
	if (!value) {
		throw new Error(`No base URL provided for the selected environment. Select an environment on the Environments page.`);
	}
	return value;
}
