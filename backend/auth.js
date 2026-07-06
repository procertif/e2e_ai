const jwt = require("jsonwebtoken");

module.exports = function createAuth({ envLocal }) {
	const AUTH_TOKEN = envLocal.AUTH_TOKEN || process.env.AUTH_TOKEN;
	const JWT_SECRET = envLocal.JWT_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY;

	if (!AUTH_TOKEN || !JWT_SECRET) {
		throw new Error("AUTH_TOKEN and JWT_PRIVATE_KEY must be set in .env");
	}

	function login(req, res) {
		const { authToken } = req.body || {};
		if (authToken !== AUTH_TOKEN) {
			res.status(401).json({ error: "Invalid auth token" });
			return;
		}
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
