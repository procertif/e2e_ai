const express = require("express");

module.exports = function createAuthController({ auth }) {
	const router = express.Router();
	router.post("/login", auth.login);
	return router;
};
