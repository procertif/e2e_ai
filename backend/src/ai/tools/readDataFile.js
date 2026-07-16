const fs = require("fs");
const path = require("path");

const IMAGE_MEDIA_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

module.exports = function createReadDataFile({ E2E_DIR, DATA_DIR, TEST_UTILS_PATH, truncate }) {
	return function readDataFile(input) {
		if (typeof input.path !== "string") return "Error: path is required.";
		const resolved = path.resolve(E2E_DIR, input.path);
		const insideData = resolved === DATA_DIR || resolved.startsWith(DATA_DIR + path.sep);
		if (!insideData && resolved !== TEST_UTILS_PATH) {
			return "Access denied: only data/ and src/testUtils.ts are reachable through this tool.";
		}
		if (!fs.existsSync(resolved)) return "Error: not found.";
		if (fs.statSync(resolved).isDirectory()) {
			const entries = fs.readdirSync(resolved, { withFileTypes: true });
			return truncate(entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).sort().join("\n") || "(empty)");
		}
		const ext = path.extname(resolved).toLowerCase().slice(1);
		if (IMAGE_MEDIA_TYPES[ext]) {
			return { _isImage: true, media_type: IMAGE_MEDIA_TYPES[ext], data: fs.readFileSync(resolved).toString("base64") };
		}
		return truncate(fs.readFileSync(resolved, "utf-8"));
	};
};
