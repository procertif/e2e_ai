import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { apiFetch, apiStreamUrl } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import { stripAnsi, filenameToFolder, extractError } from "../utils/format";
import type { Test, ScenarioAction } from "../types";

const QUEUE_STORAGE_KEY = "e2e_queue";

export interface ResultsModalData {
  launched: number;
  passed: number;
  failed: number;
  timeStr: string;
  sessionTests: Test[];
  failedTests: Test[];
  failingActions: (ScenarioAction | null)[];
  failureErrors: (string | null)[];
}

interface QueueContextValue {
  queue: Test[];
  setQueue: (updater: (prev: Test[]) => Test[]) => void;
  statusRef: React.RefObject<Record<string, string>>;
  outputRef: React.RefObject<Record<string, string>>;
  resultsModal: ResultsModalData | null;
  setResultsModal: React.Dispatch<React.SetStateAction<ResultsModalData | null>>;
  addToQueue: (test: Test) => void;
  removeFromQueue: (filename: string) => void;
  updateEstimate: (filename: string, ms: number) => void;
  runTest: (test: Test) => Promise<void>;
  runQueue: () => Promise<void>;
  resetQueue: () => void;
  isAnyRunning: boolean;
  createCampaign: (title?: string) => Promise<void>;
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { selectedEnvironment } = useEnvironment();
  const [queue, setQueue] = useState<Test[]>(() => {
    // Filenames are restored here; TestsPage backfills the full Test objects
    // once /api/tests resolves (this only needs to survive tab switches, not
    // provide fresh data before the test list loads).
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
      return saved.map((filename) => ({ filename }) as Test);
    } catch {
      return [];
    }
  });
  const [resultsModal, setResultsModal] = useState<ResultsModalData | null>(null);

  const statusRef = useRef<Record<string, string>>({});
  const outputRef = useRef<Record<string, string>>({});
  const [, setTick] = useState(0);
  const rerender = () => setTick((v) => v + 1);

  const persistQueue = (next: Test[]) => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(next.map((tst) => tst.filename)));
  };

  const updateQueue = (updater: (prev: Test[]) => Test[]) => {
    setQueue((prev) => {
      const next = updater(prev);
      persistQueue(next);
      return next;
    });
  };

  const addToQueue = (test: Test) => {
    if (queue.some((tst) => tst.filename === test.filename)) return;
    statusRef.current[test.filename] = "idle";
    updateQueue((prev) => [...prev, test]);
  };

  const removeFromQueue = (filename: string) => {
    if (statusRef.current[filename] === "running") return;
    updateQueue((prev) => prev.filter((tst) => tst.filename !== filename));
    delete statusRef.current[filename];
    delete outputRef.current[filename];
    rerender();
  };

  const resetQueue = () => {
    if (queue.some((tst) => statusRef.current[tst.filename] === "running")) return;
    statusRef.current = {};
    outputRef.current = {};
    updateQueue(() => []);
    rerender();
  };

  const updateEstimate = (filename: string, ms: number) => {
    updateQueue((prev) => prev.map((tst) => (tst.filename === filename ? { ...tst, estimatedMs: ms } : tst)));
  };

  const setCardStatus = (filename: string, status: string) => {
    statusRef.current[filename] = status;
    rerender();
  };
  const appendOutput = (filename: string, text: string) => {
    outputRef.current[filename] = (outputRef.current[filename] || "") + stripAnsi(text);
    rerender();
  };
  const clearOutput = (filename: string) => {
    outputRef.current[filename] = "";
    rerender();
  };

  const runTest = (test: Test): Promise<void> => {
    if (statusRef.current[test.filename] === "running") return Promise.resolve();
    statusRef.current[test.filename] = "running";
    clearOutput(test.filename);
    setCardStatus(test.filename, "running");

    return new Promise<void>((resolve) => {
      (async () => {
        const folder = filenameToFolder(test.filename);
        await apiFetch("/api/screenshots/" + encodeURIComponent(folder), { method: "DELETE" }).catch(() => {});

        let runId;
        try {
          const res = await apiFetch("/api/run/" + encodeURIComponent(test.filename), {
            method: "POST",
            body: JSON.stringify({ baseUrl: selectedEnvironment?.url, environmentId: selectedEnvironment?.id ?? null }),
          });
          const data = await res.json();
          runId = data.runId;
        } catch {
          appendOutput(test.filename, t("error_run_failed") + "\n");
          setCardStatus(test.filename, "failed");
          resolve();
          return;
        }

        const es = new EventSource(apiStreamUrl("/api/stream/" + runId));
        es.onmessage = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.text) {
            appendOutput(test.filename, msg.text);
          }
          if (msg.done) {
            setCardStatus(test.filename, msg.status);
            if (msg.estimatedMs != null) {
              updateEstimate(test.filename, msg.estimatedMs);
            }
            es.close();
            resolve();
          }
        };
        es.onerror = async () => {
          es.close();
          for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              const r = await apiFetch("/api/run-status/" + runId);
              if (r.ok) {
                const data = await r.json();
                if (data.status !== "running") {
                  setCardStatus(test.filename, data.status);
                  resolve();
                  return;
                }
              }
            } catch {}
          }
          setCardStatus(test.filename, "failed");
          resolve();
        };
      })();
    });
  };

  const showResultsModal = async (sessionTests: Test[], elapsedMs: number) => {
    const launched = sessionTests.length;
    const passed = sessionTests.filter((tst) => statusRef.current[tst.filename] === "passed").length;
    const failed = sessionTests.filter((tst) => statusRef.current[tst.filename] === "failed").length;

    const totalSec = elapsedMs / 1000;
    const minutes = Math.floor(totalSec / 60);
    const secs = (totalSec % 60).toFixed(0).padStart(2, "0");
    const timeStr = minutes > 0 ? `${minutes}m ${secs}s` : `${totalSec.toFixed(1)}s`;

    const failedTests = sessionTests.filter((tst) => statusRef.current[tst.filename] === "failed");

    await apiFetch("/api/session", {
      method: "POST",
      body: JSON.stringify({
        all: sessionTests.map((tst) => filenameToFolder(tst.filename)),
        failed: failedTests.map((tst) => filenameToFolder(tst.filename)),
      }),
    }).catch(() => {});

    const findFailingAction = async (tst: Test): Promise<ScenarioAction | null> => {
      const testKey = tst.filename.replace(/\.spec\.ts$/, "");
      try {
        const [actionsRes, countRes] = await Promise.all([
          apiFetch(`/api/actions/${encodeURIComponent(testKey)}`),
          apiFetch(`/api/screenshots/${encodeURIComponent(testKey)}`),
        ]);
        if (!actionsRes.ok) return null;
        const data = await actionsRes.json();
        const n = countRes.ok ? (await countRes.json()).count : 0;
        return data.actions[n] ?? data.actions[data.actions.length - 1] ?? null;
      } catch {
        return null;
      }
    };

    let failingActions: (ScenarioAction | null)[] = [];
    if (failedTests.length > 0) {
      failingActions = await Promise.all(failedTests.map(findFailingAction));
    }
    const failureErrors = failedTests.map((tst) => extractError(outputRef.current[tst.filename] || ""));

    setResultsModal({ launched, passed, failed, timeStr, sessionTests, failedTests, failingActions, failureErrors });
  };

  const runQueue = async () => {
    const sessionTests = queue;
    if (sessionTests.length === 0) return;
    const startTime = Date.now();
    for (const tst of sessionTests) {
      await runTest(tst);
    }
    await showResultsModal(sessionTests, Date.now() - startTime);
  };

  const isAnyRunning = queue.some((tst) => statusRef.current[tst.filename] === "running");

  const createCampaign = async (title?: string) => {
    if (queue.length === 0) return;
    await apiFetch("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        title: title?.trim() || null,
        environmentId: selectedEnvironment?.id ?? null,
        environmentName: selectedEnvironment?.name ?? null,
        durationMs: null,
        tests: queue.map((tst) => ({ filename: tst.filename, status: statusRef.current[tst.filename] || "idle" })),
      }),
    }).catch(() => {});
  };

  const value: QueueContextValue = {
    queue,
    setQueue: updateQueue,
    statusRef,
    outputRef,
    resultsModal,
    setResultsModal,
    addToQueue,
    removeFromQueue,
    updateEstimate,
    runTest,
    runQueue,
    resetQueue,
    isAnyRunning,
    createCampaign,
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue() {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useQueue must be used within QueueProvider");
  return ctx;
}
