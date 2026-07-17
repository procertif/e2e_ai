const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");

// SSRF guard: this tool runs with the BACKEND's network identity, so it must
// never be able to reach loopback, LAN or cloud-metadata addresses — no
// matter what hostname the model was talked into fetching. The check happens
// at DNS-resolution time through a guarded `lookup` (the validated IP is the
// one the socket actually connects to, so a hostname can't re-resolve to a
// private address behind our back), and applies again on every redirect hop.
function isPrivateIp(ip) {
	const low = ip.toLowerCase();
	if (low.includes(":")) {
		if (low.startsWith("::ffff:")) {
			// v4-mapped — URL/dns may hand it in dotted (::ffff:127.0.0.1) or
			// hex (::ffff:7f00:1) form; refuse anything unparseable.
			const rest = low.slice(7);
			if (rest.includes(".")) return isPrivateIp(rest);
			const parts = rest.split(":");
			if (parts.length !== 2) return true;
			const hi = parseInt(parts[0] || "0", 16);
			const lo = parseInt(parts[1] || "0", 16);
			if (!Number.isInteger(hi) || !Number.isInteger(lo)) return true;
			return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
		}
		return (
			low === "::" ||
			low === "::1" || // loopback
			low.startsWith("fe80:") || // link-local
			low.startsWith("fc") || low.startsWith("fd") // unique-local
		);
	}
	const p = low.split(".").map(Number);
	if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true; // unparseable → refuse
	return (
		p[0] === 0 ||
		p[0] === 127 || // loopback
		p[0] === 10 ||
		(p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
		(p[0] === 192 && p[1] === 168) ||
		(p[0] === 169 && p[1] === 254) // link-local / cloud metadata
	);
}

function guardedLookup(hostname, options, cb) {
	if (typeof options === "function") {
		cb = options;
		options = {};
	}
	dns.lookup(hostname, { ...options, all: false }, (err, address, family) => {
		if (err) return cb(err);
		if (isPrivateIp(address)) return cb(new Error(`Blocked: ${hostname} resolves to a private/local address`));
		cb(null, address, family);
	});
}

module.exports = function createWebFetch({ MAX_TOOL_OUTPUT, envLocal }) {
	// Optional strict allowlist, read from .env at startup:
	// WEBFETCH_ALLOWED_DOMAINS=docs.example.com,procertif.com
	// A hostname matches an entry exactly or as one of its subdomains.
	// Unset/empty = any PUBLIC address is allowed (the private-IP guard above
	// always applies either way).
	const raw = (envLocal?.WEBFETCH_ALLOWED_DOMAINS || process.env.WEBFETCH_ALLOWED_DOMAINS || "").trim();
	const allowedDomains = raw ? raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) : null;

	function isAllowedHost(hostname) {
		if (!allowedDomains) return true;
		const host = hostname.toLowerCase();
		return allowedDomains.some((d) => host === d || host.endsWith("." + d));
	}

	return function webFetch(input) {
		return new Promise((resolve) => {
			const maxLen = Math.min(input.max_length || MAX_TOOL_OUTPUT, MAX_TOOL_OUTPUT);
			const doRequest = (rawUrl, redirects = 0) => {
				if (redirects > 5) return resolve("Error: too many redirects");
				let url;
				try {
					url = new URL(rawUrl);
				} catch {
					return resolve("Error: invalid URL");
				}
				if (url.protocol !== "http:" && url.protocol !== "https:") {
					return resolve("Error: only http/https URLs are allowed");
				}
				if (!isAllowedHost(url.hostname)) {
					return resolve(`Error: ${url.hostname} is not in the allowed domains list`);
				}
				// Literal IPs bypass the socket's lookup() entirely — check them
				// here; hostnames are checked by guardedLookup at resolution time.
				// URL.hostname keeps the [] around IPv6 literals — strip them or
				// net.isIP() won't recognize the address.
				const bareHost = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
				if (net.isIP(bareHost) && isPrivateIp(bareHost)) {
					return resolve(`Error: Blocked: ${bareHost} is a private/local address`);
				}
				const lib = url.protocol === "https:" ? https : http;
				lib
					.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, lookup: guardedLookup }, (res) => {
						if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
							res.resume();
							// Relative redirects resolve against the current URL; the
							// next hop goes through the same protocol/allowlist/IP checks.
							let next;
							try {
								next = new URL(res.headers.location, url).href;
							} catch {
								return resolve("Error: invalid redirect location");
							}
							return doRequest(next, redirects + 1);
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
					})
					.on("error", (e) => resolve("Error: " + e.message));
			};
			doRequest(input.url);
		});
	};
};
