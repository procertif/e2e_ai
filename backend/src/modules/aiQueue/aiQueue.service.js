// A single global queue for every AI call — conversation turns and
// correction turns alike — so only one is ever in flight at a time. This
// matches the app's existing "one Playwright process at a time" rule
// (RunTest is reachable from both kinds of task) and means a task's real
// status lives in the database, not in whichever browser tab/component
// happened to start it — switching app tabs, browser tabs, or reloading
// entirely no longer loses track of what the AI is doing.
module.exports = function createAiQueueService({ db, ai, corrections, scenariosRepo }) {
	let active = null; // { id, kind, targetKey, runId }
	let watchTimer = null;
	let paused = false;
	// Separate from `paused` (the whole-queue restart safety) — this only
	// holds back correction-kind tasks, so pausing a correction batch doesn't
	// also freeze the user's normal Conversation chat.
	let correctionsPaused = false;

	function parseImages(row) {
		return row.imagesJson ? JSON.parse(row.imagesJson) : null;
	}

	async function startTask(row) {
		if (row.kind === "correction") {
			if (!corrections.get(row.targetKey)) throw new Error("Test no longer in correction.");
			return ai.startCorrectionChatRun(row.targetKey, row.message, parseImages(row), row.environmentId ?? null);
		}
		if (row.kind === "scenario") {
			if (!scenariosRepo?.get(row.targetKey)) throw new Error("Unknown scenario.");
			return ai.startScenarioChatRun(row.targetKey, row.message, parseImages(row), row.environmentId ?? null);
		}
		const seedHistory = row.seedHistoryJson ? JSON.parse(row.seedHistoryJson) : null;
		return ai.startChatRun(row.message, parseImages(row), row.targetKey || null, row.instructions || null, row.environmentId ?? null, seedHistory);
	}

	// Polls the AI's in-memory run map rather than threading a completion
	// callback through the run starters — their run.status is already the
	// source of truth every SSE consumer relies on.
	function watch() {
		if (watchTimer) return;
		// unref: this poll must never be the only thing keeping the process
		// alive (matters for tests; the HTTP server keeps prod alive anyway).
		watchTimer = setInterval(async () => {
			if (!active) {
				clearInterval(watchTimer);
				watchTimer = null;
				return;
			}
			const run = ai.getChatRun(active.runId);
			if (!run || run.status !== "running") {
				const finishedId = active.id;
				active = null;
				clearInterval(watchTimer);
				watchTimer = null;
				await db.aiQueueTask.delete({ where: { id: finishedId } }).catch(() => {});
				tick();
			}
		}, 500);
		watchTimer.unref?.();
	}

	async function tickOnce() {
		if (paused || active) return;
		const where = correctionsPaused ? { status: "queued", kind: { not: "correction" } } : { status: "queued" };
		const next = await db.aiQueueTask.findFirst({ where, orderBy: { createdAt: "asc" } });
		if (!next) return;

		let runId;
		try {
			runId = await startTask(next);
		} catch {
			// Target vanished (e.g. the correction was validated/dismissed
			// while queued) — drop this task and move on to the next one.
			await db.aiQueueTask.delete({ where: { id: next.id } }).catch(() => {});
			return tickOnce();
		}

		await db.aiQueueTask.update({ where: { id: next.id }, data: { status: "running", runId, startedAt: new Date() } });
		active = { id: next.id, kind: next.kind, targetKey: next.targetKey, runId };
		watch();
	}

	// serialize() is the answer to concurrent HTTP requests hitting stateful
	// sections at once: tickOnce's "if (active) return" guard has several
	// `await`s between checking and setting `active` (two callers could both
	// pass it and start the SAME queued task twice), and enqueue's
	// dedup-then-create below has the same check-then-act shape. Routing all
	// of them through one promise chain runs them strictly one at a time.
	// The swallowed continuation keeps the chain itself always resolved, so
	// one failure can't permanently wedge everything after it — the caller
	// still gets the rejection through the returned promise.
	let chain = Promise.resolve();
	function serialize(fn) {
		const p = chain.then(fn, fn);
		chain = p.then(
			() => {},
			(err) => console.error("[aiQueue] task error:", err?.message || err),
		);
		return p;
	}

	function tick() {
		return serialize(tickOnce);
	}

	async function enqueue({ kind, targetKey, message, images, instructions, environmentId, seedHistory }) {
		const row = await serialize(async () => {
			// One live task per target: a second "fix this test" landing while
			// one is already queued/running (another tab, a batch overlapping a
			// manual message) folds into the existing task instead of stacking
			// a duplicate run behind it.
			const existing = await db.aiQueueTask.findFirst({
				where: { kind, targetKey: targetKey || "", status: { in: ["queued", "running"] } },
			});
			if (existing) return existing;
			return db.aiQueueTask.create({
				data: {
					kind,
					targetKey: targetKey || "",
					message,
					imagesJson: images ? JSON.stringify(images) : null,
					instructions: instructions ?? null,
					environmentId: environmentId ?? null,
					seedHistoryJson: seedHistory ? JSON.stringify(seedHistory) : null,
				},
			});
		});
		await tick();
		// Re-read to pick up the status/runId tick may just have assigned; the
		// task can even already be finished (deleted) by now — fall back to
		// what we had.
		return (await db.aiQueueTask.findUnique({ where: { id: row.id } })) ?? row;
	}

	async function list() {
		const rows = await db.aiQueueTask.findMany({ where: { status: { in: ["queued", "running"] } }, orderBy: { createdAt: "asc" } });
		let position = 0;
		return rows.map((r) => {
			const isQueued = r.status === "queued";
			const entry = { id: r.id, kind: r.kind, targetKey: r.targetKey, status: r.status, runId: r.runId, position: isQueued ? position : null, environmentId: r.environmentId ?? null };
			if (isQueued) position++;
			return entry;
		});
	}

	async function get(id) {
		return db.aiQueueTask.findUnique({ where: { id: Number(id) } });
	}

	// Only removes it while still "queued" — once it's "running" there's a
	// real Claude call in flight, which the caller has to stop the normal
	// way (POST /chat-stop/:runId) using the runId this same row already
	// carries by then.
	async function cancel(id) {
		const { count } = await db.aiQueueTask.deleteMany({ where: { id: Number(id), status: "queued" } });
		return count > 0;
	}

	function isPaused() {
		return paused;
	}

	// Doesn't abort a run already in flight — it just stops the queue from
	// picking up the next task until resume().
	function resume() {
		if (!paused) return;
		paused = false;
		tick();
	}

	function isCorrectionsPaused() {
		return correctionsPaused;
	}

	// Same semantics as the queue-wide pause: the correction currently in
	// flight (if any) finishes naturally, only the NEXT correction task stays
	// held back. Conversation tasks keep flowing either way.
	function pauseCorrections() {
		correctionsPaused = true;
	}

	function resumeCorrections() {
		if (!correctionsPaused) return;
		correctionsPaused = false;
		tick();
	}

	// "Arrêter" for the whole corrections batch: drop every queued correction
	// task and abort the one currently running (its run stops at the next
	// abortable point — an in-flight RunTest still runs to completion first).
	// Also clears the corrections pause so the next batch starts clean.
	async function cancelCorrections() {
		const { count } = await db.aiQueueTask.deleteMany({ where: { kind: "correction", status: "queued" } });
		let abortedRunning = false;
		if (active?.kind === "correction") {
			const run = ai.getChatRun(active.runId);
			if (run && typeof run.abort === "function") {
				run.abort();
				abortedRunning = true;
			}
		}
		correctionsPaused = false;
		return { cancelledQueued: count, abortedRunning };
	}

	// Anything still "running" at last shutdown had its in-flight Claude call
	// die with the process either way — reset it to "queued" so it retries
	// from the same original message instead of being lost. But don't relaunch
	// it on our own: a restart is exactly when the user may not want AI calls
	// firing again unattended, so a non-empty queue comes back up PAUSED and
	// waits for an explicit resume from the UI.
	(async () => {
		await db.aiQueueTask.updateMany({ where: { status: "running" }, data: { status: "queued", runId: null, startedAt: null } });
		const stranded = await db.aiQueueTask.count({ where: { status: "queued" } });
		if (stranded > 0) {
			paused = true;
			console.log(`[aiQueue] ${stranded} task(s) pending from last shutdown — queue paused, waiting for resume.`);
		}
	})();

	return { enqueue, list, get, cancel, isPaused, resume, isCorrectionsPaused, pauseCorrections, resumeCorrections, cancelCorrections };
};
