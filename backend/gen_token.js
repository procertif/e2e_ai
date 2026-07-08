const jwt = require("jsonwebtoken");
const { execSync } = require("child_process");

// Charger l'env
const fs = require("fs");
const path = require("path");

function parseEnvFile(filePath) {
	try {
		return Object.fromEntries(
			fs.readFileSync(filePath, "utf-8")
				.split("\n")
				.filter((l) => l && !l.startsWith("#") && l.includes("="))
				.map((l) => {
					const idx = l.indexOf("=");
					return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
				}),
		);
	} catch {
		return {};
	}
}

const envLocal = parseEnvFile(path.join(__dirname, "..", ".env"));
const JWT_SECRET = envLocal.JWT_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY;
const token = jwt.sign({}, JWT_SECRET, { expiresIn: "12h" });
console.log(token);
