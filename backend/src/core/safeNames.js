// Test/action-list names come straight from the model or from URL params —
// keep them to a plain filename with no path separators or traversal, since
// they're joined onto TESTS_DIR/PENDING_DIR.
function isSafeTestname(name) {
	return typeof name === "string" && name.trim() === name && name.length > 0 && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

function isSafeTestFilename(name) {
	return typeof name === "string" && name.trim() === name && name.endsWith(".spec.ts") && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

module.exports = { isSafeTestname, isSafeTestFilename };
