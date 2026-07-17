import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faCheck, faRobot, faPen, faXmark, faPlus, faPlay, faPause, faStop, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import ScenarioEditStage from "../scenarios/ScenarioEditStage";
import { renderGherkin } from "../utils/format";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useAiQueue } from "../ai/AiQueueContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import CorrectionChatPanel from "../corrections/CorrectionChatPanel";
import { filenameToFolder } from "../utils/format";
import { useStickyScroll } from "../utils/useStickyScroll";
import type { PendingCreation, PendingCreationSummary } from "../types";
import "../styles/logs.css";
import "../styles/campaigns.css";
import "../styles/screenshots.css";
import "../styles/chat.css";
import "../styles/corrections.css";
import "../styles/scenarios.css";

type CreationTab = "console" | "editor" | "ia" | "screenshots" | "scenario";

interface CreationScreenshot {
  url: string;
  file: string;
}

// Mirror of the backend slug (creation without a picked scenario derives the
// testname from the title) so the modal can preview the filename live.
function slugify(title: string) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

// "Création de test" tab of the Tests page: drafts of brand-new tests, built
// with the AI (dedicated creation prompt) and/or the editor, then validated
// into real spec files. Same skeleton as the Corrections page — list on the
// left, Console/Éditeur/IA panel on the right — minus the batch machinery.
export default function CreationsView() {
  const { t, ready, lang } = useI18n();
  const { tasks: aiQueueTasks, creationsPaused, refresh: refreshQueue } = useAiQueue();
  const { environments, selectedId } = useEnvironment();
  const [items, setItems] = useState<PendingCreationSummary[] | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingCreation | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [validating, setValidating] = useState(false);
  // Same editor-vs-background-refresh guard as the Corrections page — see
  // the long comment there (refreshSelected).
  const editorContentRef = useRef("");
  const lastSyncedDraftRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState<CreationTab>("ia");
  const [dotCount, setDotCount] = useState(1);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [screenshots, setScreenshots] = useState<CreationScreenshot[]>([]);
  const [scenarioSpec, setScenarioSpec] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const creationTasks = aiQueueTasks.filter((task) => task.kind === "creation");

  const selectedFilenameRef = useRef<string | null>(null);
  useEffect(() => {
    selectedFilenameRef.current = selectedFilename;
  }, [selectedFilename]);

  const refreshList = async () => {
    const res = await apiFetch("/api/creations");
    const next: PendingCreationSummary[] = await res.json();
    setItems(next);
    // A test can turn "passed" between refreshes (a batch item finishing) —
    // drop it from the batch selection: it's ready to validate, nothing left
    // for the AI to do.
    const passedNow = new Set(next.filter((it) => it.lastRunStatus === "passed").map((it) => it.filename));
    setSelectedFilenames((prev) => {
      if (![...prev].some((f) => passedNow.has(f))) return prev;
      const cleaned = new Set(prev);
      for (const f of passedNow) cleaned.delete(f);
      return cleaned;
    });
  };

  // Batch machinery — same shape as the Corrections page: the global AI
  // queue IS the batch (ordering, dedup, pause, cancel), these handlers just
  // call its endpoints.
  const batchActive = creationTasks.length > 0;

  const toggleSelect = (filename: string) => {
    setSelectedFilenames((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  // Already-passed drafts are excluded from batch selection (ready to
  // validate, nothing left for the AI), and so are entries still in the
  // "write the scenario first" state — the batch builds tests FROM their
  // validated scenarios.
  const isPassed = (it: PendingCreationSummary) => it.lastRunStatus === "passed";
  const isBatchable = (it: PendingCreationSummary) => !isPassed(it) && it.scenarioValidated;
  const selectableItems = (items || []).filter(isBatchable);
  const allSelected = Boolean(selectableItems.length > 0 && selectableItems.every((it) => selectedFilenames.has(it.filename)));
  const toggleSelectAll = () => {
    setSelectedFilenames(allSelected ? new Set() : new Set(selectableItems.map((it) => it.filename)));
  };

  const startBatch = async () => {
    const list = (items || []).filter((it) => selectedFilenames.has(it.filename)).map((it) => it.filename);
    if (list.length === 0) return;
    await apiFetch("/api/creations/batch-chat", {
      method: "POST",
      body: JSON.stringify({ filenames: list, environmentId: selectedId }),
    });
    refreshQueue();
  };

  const pauseBatch = async () => {
    await apiFetch("/api/ai-queue/creations-pause", { method: "POST" });
    refreshQueue();
  };

  const resumeBatch = async () => {
    await apiFetch("/api/ai-queue/creations-resume", { method: "POST" });
    refreshQueue();
  };

  const stopBatch = async () => {
    await apiFetch("/api/creations/batch-stop", { method: "POST" });
    refreshQueue();
  };

  useEffect(() => {
    if (!ready) return;
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const refreshSelected = async (filename: string, syncEditor = false) => {
    const res = await apiFetch("/api/creations/" + encodeURIComponent(filename));
    const entry: PendingCreation | null = res.ok ? await res.json() : null;
    if (selectedFilenameRef.current !== filename) return; // switched away while in flight
    setSelected(entry);
    if (!entry) return;
    const dirty = saveTimerRef.current !== null || editorContentRef.current !== lastSyncedDraftRef.current;
    if (syncEditor || !dirty) {
      editorContentRef.current = entry.draftContent;
      lastSyncedDraftRef.current = entry.draftContent;
      setEditorContent(entry.draftContent);
    }
  };

  // Scenario spec (the test's contract — always present, a creation is
  // anchored to a scenario) and screenshots of the latest draft runs, same
  // folder convention as the Screenshots/Corrections pages.
  const loadExtras = (filename: string) => {
    apiFetch(`/api/spec/${encodeURIComponent(filename.replace(/\.spec\.ts$/, ""))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setScenarioSpec(data?.spec || null))
      .catch(() => {});
    const folder = filenameToFolder(filename);
    apiFetch("/api/screenshots")
      .then((r) => r.json())
      .then((groups: { folder: string; screenshots: CreationScreenshot[] }[]) => {
        setScreenshots(groups.find((g) => g.folder === folder)?.screenshots || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    setActiveTab("ia");
    setScreenshots([]);
    setScenarioSpec(null);
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
    loadExtras(selectedFilename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilename]);

  const handleEditorChange = (value: string | undefined) => {
    const content = value ?? "";
    setEditorContent(content);
    editorContentRef.current = content;
    if (!selectedFilename) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      lastSyncedDraftRef.current = content;
      apiFetch(`/api/creations/${encodeURIComponent(selectedFilename)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
    }, 600);
  };

  useEffect(() => {
    if (creationTasks.length === 0) {
      setDotCount(1);
      return;
    }
    const interval = setInterval(() => setDotCount((d) => (d % 3) + 1), 450);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creationTasks.length]);

  // Refetch on any creation-task status change — list badges and the draft
  // (the AI's WriteTestFile edits) live outside the queue's own state.
  const creationTasksSignature = creationTasks.map((tk) => `${tk.id}:${tk.status}`).join(",");
  useEffect(() => {
    if (!ready) return;
    refreshList();
    if (selectedFilename) {
      refreshSelected(selectedFilename);
      // A finished AI pass may just have produced fresh runs — pick up their
      // screenshots without requiring a reselection.
      loadExtras(selectedFilename);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creationTasksSignature]);

  const advanceSelection = (filename: string) => {
    setItems((prev) => {
      const next = prev ? prev.filter((it) => it.filename !== filename) : prev;
      if (selectedFilename === filename) {
        const fallback = next?.find((it) => it.filename !== filename) ?? null;
        setSelectedFilename(fallback?.filename ?? null);
      }
      return next;
    });
  };

  const openCreateModal = () => {
    setCreateModal(true);
    setNewTitle("");
    setCreateError(null);
  };

  const canCreate = Boolean(slugify(newTitle));

  // Title only — the scenario record (same name, empty spec) is registered
  // by the backend and gets written in state 1 with the scenario assistant.
  const createTest = async () => {
    if (!canCreate) return;
    setCreateError(null);
    try {
      const res = await apiFetch("/api/creations", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created: PendingCreation = await res.json();
      setCreateModal(false);
      setNewTitle("");
      await refreshList();
      setSelectedFilename(created.filename);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const validateTest = async () => {
    if (!selectedFilename) return;
    setValidating(true);
    try {
      const res = await apiFetch(`/api/creations/${encodeURIComponent(selectedFilename)}/validate`, { method: "POST" });
      if (res.ok) advanceSelection(selectedFilename);
    } finally {
      setValidating(false);
    }
  };

  const dismissTest = async (filename: string) => {
    if (!confirm(t("creation_dismiss_confirm"))) return;
    await apiFetch("/api/creations/" + encodeURIComponent(filename), { method: "DELETE" });
    advanceSelection(filename);
  };

  // State switch of the creation flow: validate the scenario (→ the
  // test-building panel, with the creation AI started automatically on the
  // currently selected environment) or reopen it for edition (Scénario
  // tab's Éditer).
  const setScenarioValidated = async (filename: string, validated: boolean) => {
    const res = await apiFetch(`/api/creations/${encodeURIComponent(filename)}/scenario-validated`, {
      method: "POST",
      body: JSON.stringify({ validated, environmentId: selectedId }),
    });
    if (!res.ok) return;
    refreshQueue();
    await refreshList();
    await refreshSelected(filename);
  };

  const consoleRef = useStickyScroll<HTMLPreElement>(selected?.consoleOutput, undefined, selectedFilename);

  const displayName = (it: { title: string | null; filename: string }) => it.title || it.filename.replace(/\.spec\.ts$/, "");
  const aiActiveOnSelected = Boolean(selected && creationTasks.some((tk) => tk.targetKey === selected.filename));

  const editorLoading = (
    <div className="corrections-editor-loading">
      <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("correction_editor_loading")}
    </div>
  );

  return (
    <>
      <div className="panels-layout corrections-layout">
        <div className="panel panel-available">
          <div className="panel-header">
            <div className="d-flex align-items-center justify-content-between">
              <h2 className="panel-title">{t("creation_tests_title")}</h2>
              <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> {t("btn_add_test")}
              </button>
            </div>
            <div className="d-flex align-items-center justify-content-between">
              <label className="correction-select-all">
                <input type="checkbox" checked={allSelected} disabled={selectableItems.length === 0} onChange={toggleSelectAll} />
                {t("correction_select_all")}
              </label>
              {batchActive ? (
                <div className="d-flex gap-2">
                  {creationsPaused ? (
                    <button className="btn btn-success btn-sm" onClick={resumeBatch}>
                      <FontAwesomeIcon icon={faPlay} style={{ fontSize: 12 }} /> {t("btn_batch_resume")}
                    </button>
                  ) : (
                    <button className="btn btn-outline-secondary btn-sm" onClick={pauseBatch}>
                      <FontAwesomeIcon icon={faPause} style={{ fontSize: 12 }} /> {t("btn_batch_pause")}
                    </button>
                  )}
                  <button className="btn btn-outline-danger btn-sm" onClick={stopBatch}>
                    <FontAwesomeIcon icon={faStop} style={{ fontSize: 12 }} /> {t("btn_batch_stop")}
                  </button>
                </div>
              ) : (
                <button className="btn btn-outline-primary btn-sm" disabled={selectedFilenames.size === 0} onClick={startBatch}>
                  <FontAwesomeIcon icon={faPlay} style={{ fontSize: 12 }} /> {t("btn_batch_start")}
                </button>
              )}
            </div>
          </div>
          <div className="panel-body">
            {items === null && <div className="groups-tab-empty"><p>{t("loading")}</p></div>}
            {items?.length === 0 && (
              <div className="groups-tab-empty">
                <FontAwesomeIcon icon={faWandMagicSparkles} style={{ fontSize: 28, opacity: 0.25 }} />
                <p>{t("creations_empty_message")}</p>
              </div>
            )}
            {items?.map((it) => {
              const task = creationTasks.find((tk) => tk.targetKey === it.filename);
              const isCurrent = task?.status === "running";
              const isQueued = task?.status === "queued";
              const taskEnvName = task ? environments.find((e) => e.id === (task.environmentId ?? it.environmentId))?.name || null : null;
              return (
                <div className={"log-item" + (it.filename === selectedFilename ? " active" : "")} key={it.filename} onClick={() => setSelectedFilename(it.filename)}>
                  <div className="log-item-top">
                    <input
                      type="checkbox"
                      className="correction-select-checkbox"
                      checked={isBatchable(it) && selectedFilenames.has(it.filename)}
                      disabled={!isBatchable(it)}
                      title={isPassed(it) ? t("creation_indicator_run_passed") : !it.scenarioValidated ? t("creation_scenario_pending_badge") : undefined}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(it.filename)}
                    />
                    <span className="campaign-list-title" title={it.filename}>{displayName(it)}</span>
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
                          <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                        </button>
                      </span>
                    )}
                  </div>
                  {isCurrent ? (
                    <div className="campaign-progress">
                      <span className="spinner-border spinner-xs" role="status" />
                      <span className="campaign-progress-text">{t("creation_running_label")}</span>
                      <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                      {taskEnvName && <span className="correction-task-env">· {taskEnvName}</span>}
                    </div>
                  ) : isQueued ? (
                    <div className="campaign-progress is-queued">
                      {creationsPaused ? (
                        <>
                          <FontAwesomeIcon icon={faPause} style={{ fontSize: 12 }} />
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
                    <div className="log-item-date">{fmtDate(it.createdAt, lang)}</div>
                  )}
                  <div className="correction-indicators">
                    {!it.scenarioValidated && (
                      <span className="scenario-link-badge scenario-link-badge--unlinked">{t("creation_scenario_pending_badge")}</span>
                    )}
                    {it.aiEdited && (
                      <span className="correction-indicator" title={t("creation_indicator_ai")}>
                        <FontAwesomeIcon icon={faRobot} style={{ fontSize: 12 }} /> {t("creation_indicator_ai")}
                      </span>
                    )}
                    {it.userEdited && (
                      <span className="correction-indicator" title={t("creation_indicator_user")}>
                        <FontAwesomeIcon icon={faPen} style={{ fontSize: 12 }} /> {t("creation_indicator_user")}
                      </span>
                    )}
                    {it.lastRunStatus === "passed" && (
                      <span className="correction-indicator correction-indicator--pass" title={t("creation_indicator_run_passed")}>
                        <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} /> {t("creation_indicator_run_passed")}
                      </span>
                    )}
                    {it.lastRunStatus === "failed" && (
                      <span className="correction-indicator correction-indicator--fail" title={t("creation_indicator_run_failed")}>
                        <FontAwesomeIcon icon={faXmark} style={{ fontSize: 12 }} /> {t("creation_indicator_run_failed")}
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
                <p>{t("creation_select_prompt")}</p>
              </div>
            </div>
          ) : selected.scenarioValidated === false ? (
            // State 1 — the scenario isn't validated yet: same experience as
            // the Scénarios page (expected result + scenario assistant), plus
            // the validation gate to move on to building the test itself.
            <>
              <div className="panel-header panel-header-row">
                <h2 className="panel-title campaign-title-static" title={selected.filename}>{displayName(selected)}</h2>
                <button
                  className="btn btn-success btn-sm"
                  disabled={!scenarioSpec?.trim()}
                  title={!scenarioSpec?.trim() ? t("creation_validate_scenario_empty_hint") : undefined}
                  onClick={() => setScenarioValidated(selected.filename, true)}
                >
                  <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} /> {t("btn_validate_scenario")}
                </button>
              </div>
              <ScenarioEditStage
                testname={selected.filename.replace(/\.spec\.ts$/, "")}
                spec={scenarioSpec}
                onUpdate={() => loadExtras(selected.filename)}
              />
            </>
          ) : (
            <>
              <div className="panel-header panel-header-row">
                <h2 className="panel-title campaign-title-static" title={selected.filename}>{displayName(selected)}</h2>
                <button
                  className="btn btn-success btn-sm"
                  disabled={validating || aiActiveOnSelected || selected.lastRunStatus !== "passed"}
                  title={selected.lastRunStatus !== "passed" ? t("creation_validate_not_passed_hint") : undefined}
                  onClick={validateTest}
                >
                  {validating ? <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> : <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} />} {t("btn_validate_creation")}
                </button>
              </div>
              <div className="correction-tabs">
                <button className={"correction-tab" + (activeTab === "ia" ? " is-active" : "")} onClick={() => setActiveTab("ia")}>
                  {t("correction_tab_ia")}
                </button>
                <button className={"correction-tab" + (activeTab === "editor" ? " is-active" : "")} onClick={() => setActiveTab("editor")}>
                  {t("correction_tab_editor")}
                </button>
                <button className={"correction-tab" + (activeTab === "console" ? " is-active" : "")} onClick={() => setActiveTab("console")}>
                  {t("correction_tab_console")}
                </button>
                <button className={"correction-tab" + (activeTab === "screenshots" ? " is-active" : "")} onClick={() => setActiveTab("screenshots")}>
                  {t("correction_tab_screenshots")} {screenshots.length > 0 && `(${screenshots.length})`}
                </button>
                <button className={"correction-tab" + (activeTab === "scenario" ? " is-active" : "")} onClick={() => setActiveTab("scenario")}>
                  {t("correction_tab_scenario")}
                </button>
              </div>
              <pre className={"correction-console-body" + (activeTab === "console" ? "" : " d-none")} ref={consoleRef}>
                {selected.consoleOutput || t("creation_console_empty")}
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
              <div className={"correction-scenario-body" + (activeTab === "scenario" ? "" : " d-none")}>
                <div className="d-flex justify-content-end" style={{ marginBottom: "0.5rem" }}>
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    disabled={aiActiveOnSelected}
                    onClick={() => setScenarioValidated(selected.filename, false)}
                  >
                    <FontAwesomeIcon icon={faPen} style={{ fontSize: 11 }} /> {t("btn_edit_scenario")}
                  </button>
                </div>
                <div className="scenario-spec">
                  <div className="spec-header">
                    <span className="spec-label">{t("spec_label_expected")}</span>
                  </div>
                  <div className="spec-body">
                    {scenarioSpec?.trim() ? (
                      <span dangerouslySetInnerHTML={{ __html: renderGherkin(scenarioSpec) }} />
                    ) : (
                      <span className="spec-generating">{t("correction_scenario_empty")}</span>
                    )}
                  </div>
                </div>
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
              <div className={activeTab === "ia" ? "correction-chat-wrap" : "correction-chat-wrap d-none"}>
                <CorrectionChatPanel
                  filename={selected.filename}
                  kind="creation"
                  apiBase="/api/creations"
                  emptyHintKey="creation_chat_empty"
                  placeholderKey="creation_chat_placeholder"
                  onUpdate={() => {
                    refreshList();
                    refreshSelected(selected.filename);
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {createModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && setCreateModal(false)}>
          <div className="results-dialog" style={{ maxWidth: 460 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_new_test_title")}</h2>
              <button className="results-close-btn" onClick={() => setCreateModal(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("creation_title_label")}</label>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder={t("creation_title_placeholder")}
                value={newTitle}
                maxLength={120}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createTest();
                  if (e.key === "Escape") setCreateModal(false);
                }}
              />
              {newTitle.trim() && (
                <p className="scenario-slug-preview">
                  {t("scenario_slug_preview")} <code>{slugify(newTitle) ? `${slugify(newTitle)}.spec.ts` : "—"}</code>
                </p>
              )}
              {createError && <p className="versioning-error" style={{ marginTop: "0.5rem" }}>{createError}</p>}
              <div className="d-flex justify-content-end gap-2" style={{ marginTop: "1rem" }}>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setCreateModal(false)}>
                  {t("btn_cancel")}
                </button>
                <button className="btn btn-primary btn-sm" disabled={!canCreate} onClick={createTest}>
                  {t("btn_create_test")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
