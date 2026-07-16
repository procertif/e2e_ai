const express = require("express");
const fs = require("fs");
const path = require("path");

// Public assets used by the frontend before/without auth. /api/lang is
// deliberately mounted BEFORE the authenticated /api router (see app.js).
module.exports = function createI18nController({ I18N_DIR, envLocal }) {
	const router = express.Router();

	router.get("/i18n/:lang(en|fr).json", (req, res) => {
		const langFile = path.join(I18N_DIR, req.params.lang + ".json");
		if (!fs.existsSync(langFile)) { res.sendStatus(404); return; }
		res.type("json").send(fs.readFileSync(langFile, "utf-8"));
	});

	router.get("/api/lang", (req, res) => {
		const lang = (envLocal.LANG || process.env.LANG || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
		res.json({ lang });
	});

	return router;
};
