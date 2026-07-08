import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "data/versioned/tests",
	outputDir: "data/test-results",
	fullyParallel: false,
	retries: 0,
	reporter: [["line"], ["./step-reporter.cjs"]],
	use: {
		baseURL: process.env.BASE_URL || "https://app.procertif.dev",
		headless: process.env.HEADLESS !== "false",
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
