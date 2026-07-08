const { execSync } = require("child_process");

if (!process.env.DATABASE_URL) {
	process.env.DATABASE_URL = "file:../../data/app.db";
}

// Creates the SQLite file (if missing) and applies any pending migrations —
// runs on every boot so `node server.js` alone is enough, no manual
// `prisma migrate deploy` step required.
try {
	execSync("npx prisma migrate deploy", { cwd: __dirname, env: process.env, stdio: "inherit" });
} catch (err) {
	console.error("[db] Migration failed:", err.message);
	process.exit(1);
}

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = prisma;
