const express = require("express");
const fs = require("fs");

module.exports = function createScreenshotsControllers({ screenshotsService }) {
	// Raw images are served without auth — the frontend loads them via
	// plain <img> tags that can't attach an Authorization header.
	const publicRouter = express.Router();
	publicRouter.get("/screenshots-img/*", (req, res) => {
		const imgPath = screenshotsService.resolveImage(req.params[0]);
		if (!imgPath) {
			res.sendStatus(404);
			return;
		}
		res.type("png").send(fs.readFileSync(imgPath));
	});

	const apiRouter = express.Router();

	apiRouter.get("/screenshots", async (req, res) => {
		res.json(await screenshotsService.listGroups());
	});

	apiRouter.get("/screenshots/:folder", (req, res) => {
		const folderPath = screenshotsService.resolveFolder(req.params.folder);
		if (!folderPath) {
			res.status(400).send("Invalid folder");
			return;
		}
		res.json({ count: screenshotsService.countPngs(folderPath) });
	});

	apiRouter.delete("/screenshots/:folder", (req, res) => {
		const folderPath = screenshotsService.resolveFolder(req.params.folder, { allowRoot: true });
		if (!folderPath) {
			res.status(400).send("Invalid folder");
			return;
		}
		screenshotsService.removeFolder(folderPath);
		res.sendStatus(204);
	});

	return { publicRouter, apiRouter };
};
