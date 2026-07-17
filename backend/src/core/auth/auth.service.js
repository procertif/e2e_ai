const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Constant-time comparison — a plain !== leaks (marginally) where the first
// differing character is.
function safeEqual(a, b) {
	const ab = Buffer.from(String(a ?? ""));
	const bb = Buffer.from(String(b ?? ""));
	return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Single shared-secret login: the client exchanges AUTH_TOKEN for a
// short-lived JWT, then every /api call is checked by requireAuth.
module.exports = function createAuthService({ envLocal }) {
	const AUTH_TOKEN = envLocal.AUTH_TOKEN || process.env.AUTH_TOKEN;
	const JWT_SECRET = envLocal.JWT_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY;

	if (!AUTH_TOKEN || !JWT_SECRET) {
		throw new Error("AUTH_TOKEN and JWT_PRIVATE_KEY must be set in .env");
	}

	// Login attempts allowed per IP within the sliding window before /login
	// starts answering 429 — brute-forcing AUTH_TOKEN gets uneconomical fast.
	// Tunable from .env: LOGIN_MAX_ATTEMPTS (default 5) and
	// LOGIN_WINDOW_SECONDS (default 60).
	const MAX_ATTEMPTS = Number(envLocal.LOGIN_MAX_ATTEMPTS || process.env.LOGIN_MAX_ATTEMPTS) || 5;
	const WINDOW_MS = (Number(envLocal.LOGIN_WINDOW_SECONDS || process.env.LOGIN_WINDOW_SECONDS) || 60) * 1000;

	// ip -> { count, resetAt } — in-memory is enough for a single-process
	// backend; entries expire with their window.
	const attempts = new Map();

	function login(req, res) {
		const ip = req.ip || req.socket?.remoteAddress || "unknown";
		const now = Date.now();
		// Opportunistic pruning so the map can't grow unbounded under a
		// spoofed-source flood.
		if (attempts.size > 10_000) {
			for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
		}
		const entry = attempts.get(ip);
		if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
			res.status(429).json({ error: "Too many attempts — retry later" });
			return;
		}
		const { authToken } = req.body || {};
		if (!safeEqual(authToken, AUTH_TOKEN)) {
			if (entry && entry.resetAt > now) entry.count++;
			else attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
			res.status(401).json({ error: "Invalid auth token" });
			return;
		}
		attempts.delete(ip);
		const token = jwt.sign({}, JWT_SECRET, { expiresIn: "12h" });
		res.json({ token });
	}

	function requireAuth(req, res, next) {
		const header = req.headers.authorization || "";
		const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
		const token = bearer || req.query.token;
		if (!token) {
			res.status(401).json({ error: "Missing token" });
			return;
		}
		try {
			jwt.verify(token, JWT_SECRET);
			next();
		} catch {
			res.status(401).json({ error: "Invalid or expired token" });
		}
	}

	return { login, requireAuth };
};
