// Accepts full GitHub URLs (https/ssh, optional .git) and the bare
// "owner/repo" shorthand.
function parseGitHubRepoUrl(url) {
	if (!url) return null;
	const m =
		url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/) ||
		url.match(/^([^/\s]+)\/([^/\s]+)$/);
	if (!m) return null;
	return { owner: m[1], repo: m[2] };
}

module.exports = { parseGitHubRepoUrl };
