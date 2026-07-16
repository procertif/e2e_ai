import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, apiStreamUrl } from "../api";
import { useEnvironment } from "../environment/EnvironmentContext";
import { useQueue } from "../queue/QueueContext";
import { filenameToFolder, stripAnsi } from "../utils/format";
import type { Campaign, CampaignTest } from "../types";

type LiveStatus = "running" | "passed" | "failed";

interface QueuedRelaunch {
  campaign: Campaign;
  mode: "all" | "failed";
}

interface CampaignQueueContextValue {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  runningCampaignId: string | null;
  queuedCampaignIds: string[];
  isBusy: boolean;
  liveStatus: Record<string, Record<string, LiveStatus>>;
  liveOutput: Record<string, Record<string, string>>;
  finishedCampaigns: Record<string, Campaign>;
  pausedCampaigns: Record<string, CampaignTest[]>;
  requestRelaunch: (campaign: Campaign, mode: "all" | "failed") => "started" | "queued" | "noop";
  requestPause: (campaignId: string) => void;
  requestStop: (campaignId: string) => void;
  requestResume: (campaign: Campaign) => void;
}

const CampaignQueueContext = createContext<CampaignQueueContextValue | null>(null);

async function runOne(
  filename: string,
  baseUrl: string,
  environmentId: number,
  onText: (text: string) => void,
  onRunId: (runId: string) => void
): Promise<"passed" | "failed"> {
  const folder = filenameToFolder(filename);
  await apiFetch("/api/screenshots/" + encodeURIComponent(folder), { method: "DELETE" }).catch(() => {});

  let runId: string;
  try {
    const res = await apiFetch("/api/run/" + encodeURIComponent(filename), {
      method: "POST",
      body: JSON.stringify({ baseUrl, environmentId }),
    });
    if (!res.ok) return "failed";
    runId = (await res.json()).runId;
    onRunId(runId);
  } catch {
    return "failed";
  }

  return new Promise((resolve) => {
    const es = new EventSource(apiStreamUrl("/api/stream/" + runId));
    es.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.text) onText(msg.text);
      if (msg.done) {
        es.close();
        resolve(msg.status === "passed" ? "passed" : "failed");
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
              resolve(data.status === "passed" ? "passed" : "failed");
              return;
            }
          }
        } catch {}
      }
      resolve("failed");
    };
  });
}

// Campaign relaunches live here (not in CampaignsPage) so a run in progress
// survives navigating away from the Campaigns page — React Router unmounts
// the page component on route change, which would otherwise wipe the
// relaunching/live-status state mid-run even though the backend keeps going.
export function CampaignQueueProvider({ children }: { children: ReactNode }) {
  const { selectedEnvironment } = useEnvironment();
  const { isAnyRunning: testsRunning } = useQueue();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningCampaignId, setRunningCampaignId] = useState<string | null>(null);
  const [queuedCampaigns, setQueuedCampaigns] = useState<QueuedRelaunch[]>([]);
  const [liveStatus, setLiveStatus] = useState<Record<string, Record<string, LiveStatus>>>({});
  const [liveOutput, setLiveOutput] = useState<Record<string, Record<string, string>>>({});
  const [finishedCampaigns, setFinishedCampaigns] = useState<Record<string, Campaign>>({});
  const [pausedCampaigns, setPausedCampaigns] = useState<Record<string, CampaignTest[]>>({});
  const pauseRequested = useRef<Set<string>>(new Set());
  const stopRequested = useRef<Set<string>>(new Set());
  const currentRunId = useRef<string | null>(null);

  // overrideTargets resumes a paused run exactly where it left off, instead
  // of re-deriving the target list from mode — the campaign object callers
  // pass in for a resume is the pre-pause one, so mode-based derivation
  // would replay tests already completed in the paused-off segment.
  const startRelaunch = async (campaign: Campaign, mode: "all" | "failed", overrideTargets?: CampaignTest[]) => {
    const env = selectedEnvironment;
    if (!env) return;
    const targets = overrideTargets || (mode === "all" ? campaign.tests : campaign.tests.filter((tst) => tst.status === "failed"));
    if (targets.length === 0) return;

    pauseRequested.current.delete(campaign.id);
    stopRequested.current.delete(campaign.id);
    setPausedCampaigns((prev) => {
      const next = { ...prev };
      delete next[campaign.id];
      return next;
    });
    setRunningCampaignId(campaign.id);
    setLiveStatus((prev) => ({
      ...prev,
      [campaign.id]: Object.fromEntries(targets.map((tst) => [tst.filename, "running" as LiveStatus])),
    }));
    setLiveOutput((prev) => ({
      ...prev,
      [campaign.id]: Object.fromEntries(targets.map((tst) => [tst.filename, ""])),
    }));

    const startTime = Date.now();
    const results: CampaignTest[] = [];
    const outputByFile: Record<string, string> = {};
    let stoppedOrPausedAt = -1;
    for (let i = 0; i < targets.length; i++) {
      if (stopRequested.current.has(campaign.id) || pauseRequested.current.has(campaign.id)) {
        stoppedOrPausedAt = i;
        break;
      }
      const tst = targets[i];
      outputByFile[tst.filename] = "";
      const status = await runOne(
        tst.filename,
        env.url,
        env.id,
        (text) => {
          outputByFile[tst.filename] += stripAnsi(text);
          setLiveOutput((prev) => ({
            ...prev,
            [campaign.id]: { ...prev[campaign.id], [tst.filename]: outputByFile[tst.filename] },
          }));
        },
        (runId) => { currentRunId.current = runId; }
      );
      currentRunId.current = null;
      results.push({ filename: tst.filename, status, output: outputByFile[tst.filename] });
      setLiveStatus((prev) => ({ ...prev, [campaign.id]: { ...prev[campaign.id], [tst.filename]: status } }));
      if (stopRequested.current.has(campaign.id)) {
        stoppedOrPausedAt = i + 1;
        break;
      }
    }
    const durationMs = Date.now() - startTime;
    const wasPaused = stoppedOrPausedAt >= 0 && pauseRequested.current.has(campaign.id) && !stopRequested.current.has(campaign.id);

    try {
      const res = await apiFetch(`/api/campaigns/${campaign.id}`, {
        method: "PUT",
        body: JSON.stringify({ tests: results, durationMs }),
      });
      if (res.ok) {
        const updated: Campaign = await res.json();
        setFinishedCampaigns((prev) => ({ ...prev, [updated.id]: updated }));
      }
    } catch {}

    setRunningCampaignId(null);
    if (wasPaused) {
      setPausedCampaigns((prev) => ({ ...prev, [campaign.id]: targets.slice(stoppedOrPausedAt) }));
    }
    setLiveStatus((prev) => {
      const next = { ...prev };
      delete next[campaign.id];
      return next;
    });
    pauseRequested.current.delete(campaign.id);
    stopRequested.current.delete(campaign.id);
  };

  const requestPause = (campaignId: string) => {
    if (runningCampaignId === campaignId) pauseRequested.current.add(campaignId);
  };

  const requestStop = (campaignId: string) => {
    if (runningCampaignId !== campaignId) return;
    stopRequested.current.add(campaignId);
    pauseRequested.current.delete(campaignId);
    if (currentRunId.current) apiFetch(`/api/kill/${currentRunId.current}`, { method: "POST" }).catch(() => {});
  };

  const requestResume = (campaign: Campaign) => {
    const remaining = pausedCampaigns[campaign.id];
    if (!remaining || remaining.length === 0 || runningCampaignId != null) return;
    startRelaunch(campaign, "all", remaining);
  };

  // Dequeue and start the next queued campaign whenever the runner frees up.
  useEffect(() => {
    if (runningCampaignId || queuedCampaigns.length === 0) return;
    const [next, ...rest] = queuedCampaigns;
    setQueuedCampaigns(rest);
    startRelaunch(next.campaign, next.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCampaignId, queuedCampaigns]);

  const requestRelaunch = (campaign: Campaign, mode: "all" | "failed"): "started" | "queued" | "noop" => {
    if (!selectedEnvironment || testsRunning) return "noop";
    const targets = mode === "all" ? campaign.tests : campaign.tests.filter((tst) => tst.status === "failed");
    if (targets.length === 0) return "noop";
    if (runningCampaignId != null) {
      setQueuedCampaigns((prev) => [...prev, { campaign, mode }]);
      return "queued";
    }
    startRelaunch(campaign, mode);
    return "started";
  };

  const value: CampaignQueueContextValue = {
    selectedId,
    setSelectedId,
    runningCampaignId,
    queuedCampaignIds: queuedCampaigns.map((q) => q.campaign.id),
    isBusy: runningCampaignId != null || queuedCampaigns.length > 0,
    liveStatus,
    liveOutput,
    finishedCampaigns,
    pausedCampaigns,
    requestRelaunch,
    requestPause,
    requestStop,
    requestResume,
  };

  return <CampaignQueueContext.Provider value={value}>{children}</CampaignQueueContext.Provider>;
}

export function useCampaignQueue() {
  const ctx = useContext(CampaignQueueContext);
  if (!ctx) throw new Error("useCampaignQueue must be used within CampaignQueueProvider");
  return ctx;
}
