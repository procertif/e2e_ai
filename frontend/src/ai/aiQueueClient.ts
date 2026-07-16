import { apiFetch } from "../api";

// A task's own POST response already gives a runId immediately if the
// queue was idle — this is only needed for the "queued" case, polling the
// single-task endpoint until aiQueue.js's tick() actually starts it and
// assigns a real runId to stream. By the time anything is queued at all,
// something else is already mid-turn (a full Claude call, seconds at
// least), so a 1s poll interval has plenty of margin — no risk of missing
// a turn that both starts and finishes between two polls.
export async function waitForTaskRunId(taskId: number, isCancelled: () => boolean): Promise<string | null> {
  while (!isCancelled()) {
    await new Promise((r) => setTimeout(r, 1000));
    if (isCancelled()) return null;
    let res: Response;
    try {
      res = await apiFetch(`/api/ai-queue/${taskId}`);
    } catch {
      continue;
    }
    if (!res.ok) return null; // task gone — already finished (or errored) between polls
    const task = await res.json();
    if (task.status === "running" && task.runId) return task.runId;
  }
  return null;
}

export async function cancelQueuedTask(taskId: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/ai-queue/${taskId}`, { method: "DELETE" });
    if (!res.ok) return false;
    return (await res.json()).cancelled === true;
  } catch {
    return false;
  }
}
