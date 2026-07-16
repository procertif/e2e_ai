import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "data/versioned/tests",
	outputDir: "data/test-results",
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
