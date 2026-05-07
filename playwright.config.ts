import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	fullyParallel: false,
	retries: 0,
	reporter: "line",
	use: {
		baseURL: process.env.BASE_URL || "https://app.procertif.dev",
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
