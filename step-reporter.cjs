// Streams a "[n/N] description" line to stdout each time a wrapped
// test.step() starts, so the running console shows live progress.
const fs = require("fs");

class StepReporter {
	onStepBegin(test, result, step) {
		if (step.category === "test.step") {
			// Playwright's CLI calls process.exit() right after the run ends, which can
			// truncate an in-flight async stdout write for the very last step. A sync
			// write to the fd completes immediately and can't be cut off by that exit.
			try {
				fs.writeSync(1, step.title + "\n");
			} catch {}
		}
	}

	printsToStdio() {
		return true;
	}
}

module.exports = StepReporter;
