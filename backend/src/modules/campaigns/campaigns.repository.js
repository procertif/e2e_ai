const fs = require("fs");
const path = require("path");
const { readJson, writeJson, listJsonFiles } = require("../../core/jsonFiles");

// One JSON file per campaign (a saved, relaunchable test-run report) under
// data/versioned/campaigns/.
module.exports = function createCampaignsRepository({ CAMPAIGNS_DIR }) {
	fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });

	function fileFor(id) {
		return path.join(CAMPAIGNS_DIR, `${id}.json`);
	}

	function list() {
		return listJsonFiles(CAMPAIGNS_DIR)
			.map((f) => readJson(path.join(CAMPAIGNS_DIR, f)))
			.filter(Boolean)
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	function get(id) {
		return readJson(fileFor(id));
	}

	function save(campaign) {
		writeJson(fileFor(campaign.id), campaign);
		return campaign;
	}

	function remove(id) {
		try {
			fs.unlinkSync(fileFor(id));
		} catch {}
	}

	return { list, get, save, remove };
};
