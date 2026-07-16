const fs = require("fs");
const path = require("path");

module.exports = function createScreenshotsService({ SCREENSHOTS_DIR, testsService }) {
	// Resolves a client-supplied folder name, refusing anything that escapes
	// SCREENSHOTS_DIR. `allowRoot` matches the historical DELETE behavior.
	function resolveFolder(folder, { allowRoot = false } = {}) {
		const folderPath = path.join(SCREENSHOTS_DIR, folder);
		if (folderPath.startsWith(SCREENSHOTS_DIR + path.sep)) return folderPath;
		if (allowRoot && folderPath === SCREENSHOTS_DIR) return folderPath;
		return null;
	}

	function resolveImage(relativePath) {
		const imgPath = path.join(SCREENSHOTS_DIR, relativePath);
		if (!imgPath.startsWith(SCREENSHOTS_DIR) || !fs.existsSync(imgPath)) return null;
		return imgPath;
	}

	function displayNameForOrphan(folder) {
		// Orphaned screenshot folder (test deleted or manually created).
		const m = folder.match(/^cas(\d+)-(.+?)(?:-(ai|noai))?$/);
		if (m) {
			const typeLabel = m[2].charAt(0).toUpperCase() + m[2].slice(1);
			return `Cas ${m[1]} - ${typeLabel}`;
		}
		return folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
	}

	async function listGroups() {
		if (!fs.existsSync(SCREENSHOTS_DIR)) return [];

		// Known tests use the exact same display name (alias or auto-generated)
		// as the test list.
		const testDisplayNames = {};
		for (const t of await testsService.listTests()) {
			testDisplayNames[t.filename.replace(".spec.ts", "")] = t.alias || t.name;
		}

		const groups = [];
		for (const folder of fs.readdirSync(SCREENSHOTS_DIR).sort()) {
			const folderPath = path.join(SCREENSHOTS_DIR, folder);
			if (!fs.statSync(folderPath).isDirectory()) continue;

			const screenshots = fs.readdirSync(folderPath)
				.filter(f => f.endsWith(".png"))
				.sort((a, b) => {
					const na = parseInt(a) || 0;
					const nb = parseInt(b) || 0;
					return na !== nb ? na - nb : a.localeCompare(b);
				})
				.map(png => ({
					url: `/screenshots-img/${encodeURIComponent(folder)}/${encodeURIComponent(png)}`,
					file: png.replace(/\.png$/, ""),
				}));

			groups.push({ folder, testName: testDisplayNames[folder] || displayNameForOrphan(folder), screenshots });
		}
		return groups;
	}

	function countPngs(folderPath) {
		if (!fs.existsSync(folderPath)) return 0;
		return fs.readdirSync(folderPath).filter(f => f.endsWith(".png")).length;
	}

	function removeFolder(folderPath) {
		if (fs.existsSync(folderPath)) {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	}

	return { resolveFolder, resolveImage, listGroups, countPngs, removeFolder };
};
