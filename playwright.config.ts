import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: /\d+-cas\d+-.+-(ai|noai)\.spec\.ts/,
	fullyParallel: false,
	retries: 0,
	reporter: "line",
	use: {
		baseURL: "https://app.procertif.dev",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		ignoreHTTPSErrors: true,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], deviceScaleFactor: undefined },
		},
	],
});
