// Prints a fresh 12h JWT for manual API calls (curl, debugging).
const path = require("path");
const jwt = require("jsonwebtoken");
const { parseEnvFile } = require("../src/core/envFile");

const envLocal = parseEnvFile(path.join(__dirname, "..", "..", ".env"));
const JWT_SECRET = envLocal.JWT_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY;
const token = jwt.sign({}, JWT_SECRET, { expiresIn: "12h" });
console.log(token);
