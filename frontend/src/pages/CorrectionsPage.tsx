import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faCheck, faRobot, faPen, faXmark, faPlay, faPause, faStop } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useAiQueue } from "../ai/AiQueueContext";
import { AiQueuePausedBanner } from "../ai/AiQueuePausedBanner";
import { useEnvironment } from "../environment/EnvironmentContext";
import { RepoUpdateBanner, RepoUpdateIcon } from "../environment/RepoUpdateBanner";
import { environmentColorHex } from "../utils/environmentColors";
import CorrectionChatPanel from "../corrections/CorrectionChatPanel";
import { filenameToFolder } from "../utils/format";
import { useStickyScroll } from "../utils/useStickyScroll";
import type { PendingCorrection, PendingCorrectionSummary, Test } from "../types";
import "../styles/groups.css";
import "../styles/logs.css";
import "../styles/campaigns.css";
import "../styles/chat.css";
import "../styles/screenshots.css";
import "../styles/corrections.css";

type CorrectionTab = "editor" | "console" | "ia" | "screenshots" | "scenario";

interface CorrectionScreenshot {
  url: string;
  file: string;
}

function TrashIcon() {
  return <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />;
}

function CheckIcon() {
  return <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} />;
}

function RobotIcon() {
  return <FontAwesomeIcon icon={faRobot} style={{ fontSize: 12 }} />;
}

function PencilIcon() {
  return <FontAwesomeIcon icon={faPen} style={{ fontSize: 12 }} />;
}

function XIcon() {
  return <FontAwesomeIcon icon={faXmark} style={{ fontSize: 12 }} />;
}

function PlayIcon() {
  return <FontAwesomeIcon icon={faPlay} style={{ fontSize: 12 }} />;
}

function PauseIcon() {
  return <FontAwesomeIcon icon={faPause} style={{ fontSize: 12 }} />;
}

function StopIcon() {
  return <FontAwesomeIcon icon={faStop} style={{ fontSize: 12 }} />;
}

function fmtDate(ms: number, lang: string) {
  const d = new Date(ms);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return (
    d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function CorrectionsPage() {
  const { t, ready, lang } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks: aiQueueTasks, correctionsPaused, refresh: refreshQueue } = useAiQueue();
  const { environments, selectedId, setSelectedId, selectedEnvironment } = useEnvironment();
  const [items, setItems] = useState<PendingCorrectionSummary[] | null>(null);
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingCorrection | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [validating, setValidating] = useState(false);
  // Mirrors editorContent/lastSyncedDraft synchronously (state updates are
  // async) so a background refresh can tell "did the user change anything
  // since we last synced from the server" without waiting a render — see
  // refreshSelected below, which is the fix for the editor getting stomped
  // by a poll-driven refresh while the user is still typing.
  const editorContentRef = useRef("");
  const lastSyncedDraftRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState<CorrectionTab>("console");
  const [dotCount, setDotCount] = useState(1);
  const [screenshots, setScreenshots] = useState<CorrectionScreenshot[]>([]);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [scenarioSpec, setScenarioSpec] = useState<string | null>(null);

  // The AI queue (see AiQueueContext) is the single and only source of
  // truth for batch state: "Démarrer" just enqueues N correction tasks on
  // it and everything on this page (per-item badges, the batch buttons) is
  // derived from what it reports. No client-side batch loop — so a reload,
  // a second tab, or a server restart can't desync what's shown from
  // what's actually running.
  const correctionTasks = aiQueueTasks.filter((task) => task.kind === "correction");
  const batchActive = correctionTasks.length > 0;

  const selectedFilenameRef = useRef<string | null>(null);
  useEffect(() => {
    selectedFilenameRef.current = selectedFilename;
  }, [selectedFilename]);

  const refreshList = async () => {
    const res = await apiFetch("/api/corrections");
    const next: PendingCorrectionSummary[] = await res.json();
    setItems(next);
    // A selected test can turn "fixed" between refreshes (a manual chat
    // turn or a batch item just confirming its own fix) — drop it from the
    // selection so it can't linger selected-but-uncheckable for the next
    // Démarrer.
    const fixedNow = new Set(next.filter((it) => it.lastRunStatus === "passed" && it.lastRunWasEdited).map((it) => it.filename));
    setSelectedFilenames((prev) => {
      if (![...prev].some((f) => fixedNow.has(f))) return prev;
      const cleaned = new Set(prev);
      for (const f of fixedNow) cleaned.delete(f);
      return cleaned;
    });
  };

  const testTitle = (filename: string) => {
    const info = allTests.find((x) => x.filename === filename);
    return info?.alias || info?.name || filename;
  };

  useEffect(() => {
    if (!ready) return;
    refreshList();
    apiFetch("/api/tests").then((r) => r.json()).then(setAllTests);
    const fromUrl = searchParams.get("filename");
    if (fromUrl) setSelectedFilename(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // syncEditor=true forces the editor to whatever the server has (a fresh
  // file selection, where there's nothing local to lose). syncEditor=false
  // is for background refreshes (the AI-queue poll, a chat turn finishing)
  // that shouldn't clobber the editor if the user has typed something since
  // the last sync that hasn't round-tripped through the debounced PUT yet —
  // otherwise a poll landing mid-keystroke resets Monaco to stale content
  // and drops whatever was just typed.
  const refreshSelected = async (filename: string, syncEditor = false) => {
    const res = await apiFetch("/api/corrections/" + encodeURIComponent(filename));
    const entry: PendingCorrection | null = res.ok ? await res.json() : null;
    if (selectedFilenameRef.current !== filename) return; // switched away while this was in flight
    setSelected(entry);
    if (!entry) return;
    const dirty = saveTimerRef.current !== null || editorContentRef.current !== lastSyncedDraftRef.current;
    if (syncEditor || !dirty) {
      editorContentRef.current = entry.draftContent;
      lastSyncedDraftRef.current = entry.draftContent;
      setEditorContent(entry.draftContent);
    }
  };

  useEffect(() => {
    setActiveTab("console");
    setScreenshots([]);
    setScenarioSpec(null);
    if (selectedFilename) {
      apiFetch(`/api/spec/${encodeURIComponent(selectedFilename.replace(/\.spec\.ts$/, ""))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setScenarioSpec(data?.spec || null))
        .catch(() => {});
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!selectedFilename) {
      setSelected(null);
      editorContentRef.current = "";
      lastSyncedDraftRef.current = null;
      setEditorContent("");
      return;
    }
    refreshSelected(selectedFilename, true);
    // Screenshots from the run that's currently failing this test — same
    // folder the classic Screenshots page groups by, just filtered to this
    // one test instead of showing every group.
    const folder = filenameToFolder(selectedFilename);
    apiFetch("/api/screenshots")
      .then((r) => r.json())
      .then((groups: { folder: string; screenshots: CorrectionScreenshot[] }[]) => {
        setScreenshots(groups.find((g) => g.folder === folder)?.screenshots || []);
      })
      .catch(() => {});
  }, [selectedFilename]);

  const selectTest = (filename: string) => {
    setSelectedFilename(filename);
    setSearchParams({ filename });
  };

  const handleEditorChange = (value: string | undefined) => {
    const content = value ?? "";
    setEditorContent(content);
    editorContentRef.current = content;
    if (!selectedFilename) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      lastSyncedDraftRef.current = content;
      apiFetch(`/api/corrections/${encodeURIComponent(selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
    }, 600);
  };

  useEffect(() => {
    if (correctionTasks.length === 0) {
      setDotCount(1);
      return;
    }
    const interval = setInterval(() => setDotCount((d) => (d % 3) + 1), 450);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctionTasks.length]);

  const toggleSelect = (filename: string) => {
    setSelectedFilenames((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  // "Correction validée par le test" — already fixed and confirmed by its
  // own last run, nothing left to (re)try here. Same predicate as the
  // fix-passed badge below.
  const isFixed = (it: PendingCorrectionSummary) => it.lastRunStatus === "passed" && it.lastRunWasEdited;
  const selectableItems = (items || []).filter((it) => !isFixed(it));

  const allSelected = Boolean(selectableItems.length > 0 && selectableItems.every((it) => selectedFilenames.has(it.filename)));
  const toggleSelectAll = () => {
    setSelectedFilenames(allSelected ? new Set() : new Set(selectableItems.map((it) => it.filename)));
  };

  // The batch is entirely backend-side: N correction tasks on the global AI
  // queue (POST /corrections/batch-chat), which already handles ordering,
  // one-live-task-per-test dedup, pause and cancel. These four handlers
  // just call the queue's endpoints and refresh — display state comes back
  // through the AiQueueContext poll like for any other task.
  // Each task captures the environment selected at enqueue time — start a
  // batch on one environment, switch the selector, start another: the two
  // batches keep their own targets (RunTest's BASE_URL and FindSelector's
  // repository both follow the task's environment, see ia.js).
  const startBatch = async () => {
    const list = (items || []).filter((it) => selectedFilenames.has(it.filename)).map((it) => it.filename);
    if (list.length === 0) return;
    await apiFetch("/api/corrections/batch-chat", {
      method: "POST",
      body: JSON.stringify({ filenames: list, environmentId: selectedId }),
    });
    refreshQueue();
  };

  // Held at the queue level: the correction currently running finishes
  // naturally, only the next ones stay queued. Conversation tasks keep
  // flowing while corrections are paused.
  const pauseBatch = async () => {
    await apiFetch("/api/ai-queue/corrections-pause", { method: "POST" });
    refreshQueue();
  };

  const resumeBatch = async () => {
    await apiFetch("/api/ai-queue/corrections-resume", { method: "POST" });
    refreshQueue();
  };

  // Cancels every queued correction task and aborts the running one. The
  // running task's badge honestly stays "en cours" until its run actually
  // dies (an in-flight RunTest isn't abortable) — the buttons stay in
  // batch mode until then, which is what's really happening.
  const stopBatch = async () => {
    await apiFetch("/api/corrections/batch-stop", { method: "POST" });
    refreshQueue();
  };

  // The queue only tracks "queued/running" — corrections.js's own
  // aiEdited/lastRunStatus/draftContent (what the badges below and the
  // editor/console tabs show) live separately, so refetch whenever a
  // correction task's status changes or one disappears (finished).
  const correctionTasksSignature = correctionTasks.map((t) => `${t.id}:${t.status}`).join(",");
  useEffect(() => {
    if (!ready) return;
    refreshList();
    if (selectedFilename) refreshSelected(selectedFilename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctionTasksSignature]);

  const advanceSelection = (filename: string) => {
    setItems((prev) => {
      const next = prev ? prev.filter((it) => it.filename !== filename) : prev;
      if (selectedFilename === filename) {
        const fallback = next?.find((it) => it.filename !== filename) ?? null;
        setSelectedFilename(fallback?.filename ?? null);
        setSearchParams(fallback ? { filename: fallback.filename } : {});
      }
      return next;
    });
  };

  const validateTest = async () => {
    if (!selectedFilename) return;
    setValidating(true);
    try {
      const res = await apiFetch(`/api/corrections/${encodeURIComponent(selectedFilename)}/validate`, { method: "POST" });
      if (res.ok) advanceSelection(selectedFilename);
    } finally {
      setValidating(false);
    }
  };

  const dismissTest = async (filename: string) => {
    if (!confirm(t("correction_dismiss_confirm"))) return;
    await apiFetch("/api/corrections/" + encodeURIComponent(filename), { method: "DELETE" });
    advanceSelection(filename);
  };

  const consoleRef = useStickyScroll<HTMLPreElement>(selected?.consoleOutput, undefined, selectedFilename);

  // While the AI is actively working this test's draft (queued or running),
  // its own WriteTestFile calls and a human typing in the editor would race
  // on the same draft — whichever writes last silently wins. Locking the
  // editor for the duration avoids that; the IA tab already shows what it's
  // doing live.
  const aiActiveOnSelected = Boolean(selected && correctionTasks.some((t) => t.targetKey === selected.filename));

  const editorLoading = (
    <div className="corrections-editor-loading">
      <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("correction_editor_loading")}
    </div>
  );

  return (
    <>
      <div className="app-topbar">
        <h1>{t("corrections_page_title")}</h1>
        <span className="badge-env">CORRECTION</span>
      </div>

      <div className="app-content">
        <AiQueuePausedBanner />
        <RepoUpdateBanner environment={selectedEnvironment} />
        <div className="target-environment-bar">
          <span className="environment-color-dot" style={{ background: selectedEnvironment ? environmentColorHex(selectedEnvironment.color) : "#ced4da" }} />
          <label className="target-environment-label" htmlFor="corrections-target-environment-select">
            {t("target_environment_label")}
          </label>
          <select
            id="corrections-target-environment-select"
            className="form-select form-select-sm target-environment-select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <RepoUpdateIcon environment={selectedEnvironment} />
        </div>
        <div className="panels-layout corrections-layout">
          <div className="panel panel-available">
            <div className="panel-header">
              <div className="d-flex align-items-center justify-content-between">
                <h2 className="panel-title">{t("correction_tests_title")}</h2>
                <span className="avail-count">{items?.length ?? 0}</span>
              </div>
              <div className="d-flex align-items-center justify-content-between">
                <label className="correction-select-all">
                  <input type="checkbox" checked={allSelected} disabled={selectableItems.length === 0} onChange={toggleSelectAll} />
                  {t("correction_select_all")}
                </label>
                {batchActive ? (
                  <div className="d-flex gap-2">
                    {correctionsPaused ? (
                      <button className="btn btn-success btn-sm" onClick={resumeBatch}>
                        <PlayIcon /> {t("btn_batch_resume")}
                      </button>
                    ) : (
                      <button className="btn btn-outline-secondary btn-sm" onClick={pauseBatch}>
                        <PauseIcon /> {t("btn_batch_pause")}
                      </button>
                    )}
                    <button className="btn btn-outline-danger btn-sm" onClick={stopBatch}>
                      <StopIcon /> {t("btn_batch_stop")}
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-outline-primary btn-sm" disabled={selectedFilenames.size === 0} onClick={startBatch}>
                    <PlayIcon /> {t("btn_batch_start")}
                  </button>
                )}
              </div>
            </div>
            <div className="panel-body">
              {items === null && <div className="groups-tab-empty"><p>{t("loading")}</p></div>}
              {items?.length === 0 && (
                <div className="groups-tab-empty">
                  <p>{t("corrections_empty_message")}</p>
                </div>
              )}
              {items?.map((it) => {
                // Straight from the backend queue — "running" means the AI is
                // really working this test right now, "queued" means a task
                // really exists and is waiting its turn.
                const task = correctionTasks.find((t) => t.targetKey === it.filename);
                const isCurrent = task?.status === "running";
                const isQueued = task?.status === "queued";
                // Environment the task was enqueued against (batch selector or
                // IA tab at send time) — falls back to the campaign's one, as
                // the backend does when actually running it.
                const taskEnvName = task
                  ? environments.find((e) => e.id === (task.environmentId ?? it.environmentId))?.name || null
                  : null;
                return (
                  <div className={"log-item" + (it.filename === selectedFilename ? " active" : "")} key={it.filename} onClick={() => selectTest(it.filename)}>
                    <div className="log-item-top">
                      <input
                        type="checkbox"
                        className="correction-select-checkbox"
                        checked={!isFixed(it) && selectedFilenames.has(it.filename)}
                        disabled={isFixed(it)}
                        title={isFixed(it) ? t("correction_indicator_fix_passed") : undefined}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(it.filename)}
                      />
                      <span className="campaign-list-title" title={it.filename}>{testTitle(it.filename)}</span>
                      {!isCurrent && !isQueued && (
                        <span className="log-item-actions">
                          <button
                            className="log-delete-btn"
                            title={t("btn_delete_title")}
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissTest(it.filename);
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </span>
                      )}
                    </div>
                    {isCurrent ? (
                      <div className="campaign-progress">
                        <span className="spinner-border spinner-xs" role="status" />
                        <span className="campaign-progress-text">{t("correction_bulk_running_label")}</span>
                        <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                        {taskEnvName && <span className="correction-task-env">· {taskEnvName}</span>}
                      </div>
                    ) : isQueued ? (
                      <div className="campaign-progress is-queued">
                        {correctionsPaused ? (
                          <>
                            <PauseIcon />
                            <span className="campaign-progress-text">{t("correction_bulk_paused_label")}</span>
                          </>
                        ) : (
                          <>
                            <span className="spinner-border spinner-xs" role="status" />
                            <span className="campaign-progress-text">{t("correction_bulk_queued_label")}</span>
                            <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                          </>
                        )}
                        {taskEnvName && <span className="correction-task-env">· {taskEnvName}</span>}
                      </div>
                    ) : (
                      <div className="log-item-date">
                        {it.campaignTitle || t("campaign_untitled_prefix")} · {fmtDate(it.createdAt, lang)}
                      </div>
                    )}
                    <div className="correction-indicators">
                      {it.aiEdited && (
                        <span className="correction-indicator" title={t("correction_indicator_ai")}>
                          <RobotIcon /> {t("correction_indicator_ai")}
                        </span>
                      )}
                      {it.userEdited && (
                        <span className="correction-indicator" title={t("correction_indicator_user")}>
                          <PencilIcon /> {t("correction_indicator_user")}
                        </span>
                      )}
                      {it.lastRunStatus === "passed" && it.lastRunWasEdited && (
                        <span className="correction-indicator correction-indicator--pass" title={t("correction_indicator_fix_passed")}>
                          <CheckIcon /> {t("correction_indicator_fix_passed")}
                        </span>
                      )}
                      {it.lastRunStatus === "failed" && it.lastRunWasEdited && (
                        <span className="correction-indicator correction-indicator--fail" title={t("correction_indicator_fix_failed")}>
                          <XIcon /> {t("correction_indicator_fix_failed")}
                        </span>
                      )}
                      {it.lastRunStatus === "failed" && !it.lastRunWasEdited && (
                        <span className="correction-indicator correction-indicator--fail" title={t("correction_indicator_original_failed")}>
                          <XIcon /> {t("correction_indicator_original_failed")}
                        </span>
                      )}
                      {it.lastRunStatus === "passed" && !it.lastRunWasEdited && (
                        <span className="correction-indicator" title={t("correction_indicator_original_passed")}>
                          <CheckIcon /> {t("correction_indicator_original_passed")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel panel-queue corrections-editor-panel">
            {!selected ? (
              <div className="panel-body">
                <div className="queue-empty">
                  <p>{t("correction_select_prompt")}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="panel-header panel-header-row">
                  <h2 className="panel-title campaign-title-static" title={selected.filename}>{testTitle(selected.filename)}</h2>
                  <button className="btn btn-success btn-sm" disabled={validating || aiActiveOnSelected} onClick={validateTest}>
                    {validating ? <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> : <CheckIcon />} {t("btn_validate_correction")}
                  </button>
                </div>
                <div className="correction-tabs">
                  <button className={"correction-tab" + (activeTab === "console" ? " is-active" : "")} onClick={() => setActiveTab("console")}>
                    {t("correction_tab_console")}
                  </button>
                  <button className={"correction-tab" + (activeTab === "editor" ? " is-active" : "")} onClick={() => setActiveTab("editor")}>
                    {t("correction_tab_editor")}
                  </button>
                  <button className={"correction-tab" + (activeTab === "ia" ? " is-active" : "")} onClick={() => setActiveTab("ia")}>
                    {t("correction_tab_ia")}
                  </button>
                  <button className={"correction-tab" + (activeTab === "screenshots" ? " is-active" : "")} onClick={() => setActiveTab("screenshots")}>
                    {t("correction_tab_screenshots")} {screenshots.length > 0 && `(${screenshots.length})`}
                  </button>
                  <button className={"correction-tab" + (activeTab === "scenario" ? " is-active" : "")} onClick={() => setActiveTab("scenario")}>
                    {t("correction_tab_scenario")}
                  </button>
                </div>
                <pre className={"correction-console-body" + (activeTab === "console" ? "" : " d-none")} ref={consoleRef}>
                  {selected.consoleOutput || t("correction_console_empty")}
                </pre>
                <div className={"corrections-editor-body" + (activeTab === "editor" ? "" : " d-none")}>
                  {aiActiveOnSelected && (
                    <div className="correction-editor-readonly-hint">{t("correction_editor_ai_locked")}</div>
                  )}
                  <div className="corrections-editor-container">
                    <Editor
                      height="100%"
                      language="typescript"
                      theme="vs-dark"
                      value={editorContent}
                      onChange={handleEditorChange}
                      loading={editorLoading}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        scrollBeyondLastLine: false,
                        padding: { top: 16, bottom: 16 },
                        automaticLayout: true,
                        readOnly: aiActiveOnSelected,
                      }}
                    />
                  </div>
                </div>
                <div className={activeTab === "ia" ? "correction-chat-wrap" : "correction-chat-wrap d-none"}>
                  <CorrectionChatPanel
                    filename={selected.filename}
                    onUpdate={() => {
                      refreshList();
                      refreshSelected(selected.filename);
                    }}
                  />
                </div>
                <div className={"correction-scenario-body" + (activeTab === "scenario" ? "" : " d-none")}>
                  {scenarioSpec ? (
                    <pre className="correction-scenario-spec">{scenarioSpec}</pre>
                  ) : (
                    <p className="correction-chat-hint">{t("correction_scenario_empty")}</p>
                  )}
                </div>
                <div className={"correction-screenshots-body" + (activeTab === "screenshots" ? "" : " d-none")}>
                  {screenshots.length === 0 ? (
                    <p className="correction-chat-hint">{t("correction_screenshots_empty")}</p>
                  ) : (
                    <div className="screenshots-grid">
                      {screenshots.map((s) => (
                        <a className="screenshot-card-wrap" href={s.url} target="_blank" rel="noreferrer" key={s.file}>
                          <div className="screenshot-card">
                            <img className="screenshot-thumb" src={s.url} alt={s.file} loading="lazy" />
                            <div className="screenshot-label">{s.file}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
