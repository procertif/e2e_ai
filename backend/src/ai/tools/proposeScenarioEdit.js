// Correction-run only: stores a scenario-edition proposal on the correction
// entry. The UI shows it as a banner above the IA chat; accepting it opens
// the scenario editor and forwards `message` to the scenario assistant.
// Nothing is modified here — the human stays in the loop.
module.exports = function createProposeScenarioEdit() {
	return function proposeScenarioEdit(input, ctx) {
		if (!ctx?.correctionFilename || !ctx?.corrections?.setScenarioEditProposal) {
			return "Error: ProposeScenarioEdit is only available in correction conversations.";
		}
		const message = typeof input?.message === "string" ? input.message.trim() : "";
		if (!message) return "Error: message is required.";
		ctx.corrections.setScenarioEditProposal(ctx.correctionFilename, { message, createdAt: Date.now() });
		return "Proposition d'édition du scénario enregistrée — l'utilisateur voit maintenant un bandeau lui proposant d'ouvrir l'éditeur de scénario avec ton message.";
	};
};
