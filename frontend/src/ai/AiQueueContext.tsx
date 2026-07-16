import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../api";

export interface AiQueueTaskSummary {
  id: number;
  kind: "conversation" | "correction" | "scenario";
  targetKey: string;
  status: "queued" | "running";
  runId: string | null;
  position: number | null;
  environmentId: number | null;
}

interface AiQueueContextValue {
  tasks: AiQueueTaskSummary[];
  paused: boolean;
  correctionsPaused: boolean;
  findTask: (kind: "conversation" | "correction" | "scenario", targetKey: string) => AiQueueTaskSummary | undefined;
  refresh: () => Promise<void>;
  resume: () => Promise<void>;
}

const AiQueueContext = createContext<AiQueueContextValue | null>(null);

// Polls the global AI queue so any component — whether or not it's the one
// that enqueued a given task — can render its current status. This is what
// lets a badge in the Correction list (or a future Conversation sidebar
// indicator) stay accurate after a reload or a tab switch, without needing
// to remember a taskId itself.
export function AiQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<AiQueueTaskSummary[]>([]);
  // Set by the backend at startup when tasks were stranded by the last
  // shutdown — nothing dequeues until the user explicitly resumes.
  const [paused, setPaused] = useState(false);
  // Corrections-only pause (the Corrections page's batch Pause button) —
  // conversation tasks keep running while this is on.
  const [correctionsPaused, setCorrectionsPaused] = useState(false);

  const refresh = async () => {
    try {
      const res = await apiFetch("/api/ai-queue");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks);
        setPaused(data.paused === true);
        setCorrectionsPaused(data.correctionsPaused === true);
      }
    } catch {}
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 1500);
    return () => clearInterval(interval);
  }, []);

  const resume = async () => {
    try {
      const res = await apiFetch("/api/ai-queue/resume", { method: "POST" });
      if (res.ok) setPaused((await res.json()).paused === true);
    } catch {}
  };

  const findTask = (kind: "conversation" | "correction" | "scenario", targetKey: string) =>
    tasks.find((t) => t.kind === kind && t.targetKey === targetKey);

  return <AiQueueContext.Provider value={{ tasks, paused, correctionsPaused, findTask, refresh, resume }}>{children}</AiQueueContext.Provider>;
}

export function useAiQueue() {
  const ctx = useContext(AiQueueContext);
  if (!ctx) throw new Error("useAiQueue must be used within AiQueueProvider");
  return ctx;
}
