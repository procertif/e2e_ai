const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGE_MEDIA_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// The API rejects any image whose longest side exceeds 2000px once a request
// carries many images (a long correction chat full of screenshots does), so
// every image is capped here at the source. 1568px is Claude's own optimal
// ceiling — anything bigger is downscaled server-side anyway and just costs
// more tokens.
const MAX_IMAGE_DIMENSION = 1568;

async function toApiImage(buffer, mediaType) {
	try {
		const image = sharp(buffer);
		const { width, height } = await image.metadata();
		if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
			const resized = await image.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside" }).png().toBuffer();
			return { _isImage: true, media_type: "image/png", data: resized.toString("base64") };
		}
	} catch {
		// Unreadable/corrupt image — send the original bytes and let the API decide.
	}
	return { _isImage: true, media_type: mediaType, data: buffer.toString("base64") };
}

module.exports = function createReadDataFile({ E2E_DIR, DATA_DIR, TEST_UTILS_PATH, truncate }) {
	return async function readDataFile(input) {
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
			return toApiImage(fs.readFileSync(resolved), IMAGE_MEDIA_TYPES[ext]);
		}
		return truncate(fs.readFileSync(resolved, "utf-8"));
	};
};
