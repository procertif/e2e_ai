const http = require("http");
const https = require("https");

module.exports = function createWebFetch({ MAX_TOOL_OUTPUT }) {
	return function webFetch(input) {
		return new Promise((resolve) => {
			const maxLen = Math.min(input.max_length || MAX_TOOL_OUTPUT, MAX_TOOL_OUTPUT);
			const lib = input.url.startsWith("https") ? https : http;
			const doRequest = (url, redirects = 0) => {
				if (redirects > 5) return resolve("Error: too many redirects");
				lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
					if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						return doRequest(res.headers.location, redirects + 1);
					}
					let body = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk) => { if (body.length < maxLen * 2) body += chunk; });
					res.on("end", () => {
						body = body
							.replace(/<script[\s\S]*?<\/script>/gi, "")
							.replace(/<style[\s\S]*?<\/style>/gi, "")
							.replace(/<[^>]+>/g, " ")
							.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
							.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
							.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
						resolve(body.slice(0, maxLen));
					});
					res.on("error", (e) => resolve("Error: " + e.message));
				}).on("error", (e) => resolve("Error: " + e.message));
			};
			doRequest(input.url);
		});
	};
};
