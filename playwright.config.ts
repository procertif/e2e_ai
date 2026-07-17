import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "data/versioned/tests",
	// Nested one level down on purpose: Playwright wipes and recreates its
	// outputDir on every run, which needs WRITE on the parent directory. In
	// Docker the runner is the restricted e2erunner account and /app/data is
	// locked down — data/test-results (owned by e2erunner, see
	// docker-entrypoint.sh) is the writable parent.
	outputDir: "data/test-results/run",
	fullyParallel: false,
	retries: 0,
	reporter: [["line"], ["./src/step-reporter.cjs"]],
	use: {
		baseURL: process.env.DEFAULT_URL,
		headless: process.env.HEADLESS == "true",
		trace: "off",
		screenshot: "off",
		ignoreHTTPSErrors: true,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], deviceScaleFactor: undefined },
		},
	],
});
