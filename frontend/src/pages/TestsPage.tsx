import { useEffect, useRef, useState, type DragEvent } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { GROUP_COLORS, badgeClass, fuzzyMatch, formatDuration } from "../utils/format";
import { environmentColorHex } from "../utils/environmentColors";
import { useSelectedEnvironment } from "../hooks/useSelectedEnvironment";
import { useQueue } from "../queue/QueueContext";
import type { Test, Group } from "../types";
import "../styles/groups.css";
import "../styles/environments.css";

function cardId(filename: string) {
  return "card-" + filename.replace(/[^a-zA-Z0-9]/g, "-");
}

function getDragAfterElement(container: HTMLElement, y: number) {
  const cards = [...container.querySelectorAll<HTMLElement>(".test-card:not(.is-dragging)")];
  return cards.reduce<{ offset: number; element: HTMLElement | null }>(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}

export default function TestsPage() {
  const { t, ready } = useI18n();
  const { environments, selectedId, setSelectedId, selectedEnvironment } = useSelectedEnvironment();
  const {
    queue,
    setQueue,
    statusRef,
    outputRef,
    resultsModal,
    setResultsModal,
    addToQueue,
    removeFromQueue,
    runTest,
    runQueue,
    resetQueue,
    isAnyRunning,
  } = useQueue();
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [activeTab, setActiveTab] = useState<"tests" | "groups">("tests");
  const [query, setQuery] = useState("");
  const [draggingFilename, setDraggingFilename] = useState<string | null>(null);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);

  const queueListRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    (async () => {
      const [tests, grps] = await Promise.all([
        apiFetch("/api/tests").then((r) => r.json()),
        apiFetch("/api/groups").then((r) => r.json()),
      ]);
      setAllTests(tests);
      setAllGroups(grps);

      // Hydrate queue entries restored (filename-only) from localStorage with
      // full test metadata, without disturbing entries/status already live
      // from a previous mount of this page in the same session.
      setQueue((prev) => prev.map((tst) => tests.find((x: Test) => x.filename === tst.filename) || tst));
      for (const tst of queue) {
        if (!statusRef.current[tst.filename]) statusRef.current[tst.filename] = "idle";
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const queueSet = new Set(queue.map((tst) => tst.filename));

  const environmentBadge = (tst: Test) => {
    if (!tst.environmentName) {
      return <span className="test-badge-environment">{t("environment_unassigned")}</span>;
    }
    const env = environments.find((e) => e.id === tst.environmentId);
    return (
      <span className="test-badge-environment">
        {env && <span className="environment-color-dot" style={{ background: environmentColorHex(env.color) }} />}
        {tst.environmentName}
      </span>
    );
  };

  const copyOutput = async (filename: string) => {
    try {
      await navigator.clipboard.writeText(outputRef.current[filename] || "");
      setCopiedFilename(filename);
      setTimeout(() => setCopiedFilename((f) => (f === filename ? null : f)), 1500);
    } catch {}
  };

  // ── Drag & drop (queue reorder) ──

  const onDragStart = (filename: string) => setDraggingFilename(filename);
  const onDragEnd = () => setDraggingFilename(null);
  const onQueueDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggingFilename || !queueListRef.current) return;
    const afterEl = getDragAfterElement(queueListRef.current, e.clientY);
    const afterFilename = afterEl ? afterEl.dataset.filename : null;

    setQueue((prev) => {
      const without = prev.filter((tst) => tst.filename !== draggingFilename);
      const dragged = prev.find((tst) => tst.filename === draggingFilename);
      if (!dragged) return prev;
      let next;
      if (afterFilename == null) {
        next = [...without, dragged];
      } else {
        const idx = without.findIndex((tst) => tst.filename === afterFilename);
        next = [...without.slice(0, idx), dragged, ...without.slice(idx)];
      }
      const same = next.length === prev.length && next.every((tst, i) => tst.filename === prev[i].filename);
      return same ? prev : next;
    });
  };

  // ── Groups tab ──

  const switchTab = async (tab: "tests" | "groups") => {
    setActiveTab(tab);
    if (tab === "groups") {
      const grps = await apiFetch("/api/groups").then((r) => r.json());
      setAllGroups(grps);
    }
  };

  const addGroupToQueue = (groupId: string) => {
    const group = allGroups.find((g) => g.id === groupId);
    if (!group) return;
    for (const fn of group.tests) {
      const test = allTests.find((tst) => tst.filename === fn);
      if (test && !queueSet.has(fn)) addToQueue(test);
    }
  };

  const filteredTests = allTests.filter((tst) => fuzzyMatch(tst.alias || tst.name, query));
  const filteredGroups = query.trim() ? allGroups.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase())) : allGroups;

  const totalMs = queue.reduce((a, tst) => a + (tst.estimatedMs || 0), 0);
  const knownCount = queue.filter((tst) => tst.estimatedMs).length;
  let queueLabel = queue.length === 0 ? "0 test" : `${queue.length} test${queue.length > 1 ? "s" : ""}`;
  if (totalMs > 0) {
    const partial = knownCount < queue.length ? " partiel" : "";
    queueLabel += ` · ~${formatDuration(totalMs)}${partial}`;
  }

  return (
    <div className="app-content">
      <div className="target-environment-bar">
        <span className="environment-color-dot" style={{ background: selectedEnvironment ? environmentColorHex(selectedEnvironment.color) : "#ced4da" }} />
        <label className="target-environment-label" htmlFor="target-environment-select">
          {t("target_environment_label")}
        </label>
        <select
          id="target-environment-select"
          className="form-select form-select-sm target-environment-select"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t("target_environment_none_option")}</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="panels-layout">
        <div className="panel panel-available">
          <div className="panel-header">
            <div className="d-flex align-items-center justify-content-between">
              <h2 className="panel-title">{t("panel_available_title")}</h2>
              <span className="avail-count">
                {activeTab === "tests"
                  ? filteredTests.length !== allTests.length
                    ? `${filteredTests.length}/${allTests.length} tests`
                    : `${allTests.length} tests`
                  : filteredGroups.length !== allGroups.length
                    ? `${filteredGroups.length}/${allGroups.length} groupes`
                    : `${allGroups.length} groupe${allGroups.length !== 1 ? "s" : ""}`}
              </span>
            </div>
            <div className="panel-tabs">
              <button className={"panel-tab" + (activeTab === "tests" ? " active" : "")} onClick={() => switchTab("tests")}>
                {t("panel_tab_tests")}
              </button>
              <button className={"panel-tab" + (activeTab === "groups" ? " active" : "")} onClick={() => switchTab("groups")}>
                {t("panel_tab_groups")}
              </button>
            </div>
            <div className="panel-search-wrap">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zm-5.242 1.156a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11" />
              </svg>
              <input
                type="text"
                className="panel-search-input"
                placeholder={t("search_available_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="panel-body">
            {activeTab === "tests" ? (
              <div>
                {filteredTests.map((tst) => {
                  const isQueued = queueSet.has(tst.filename);
                  return (
                    <div className={"avail-item" + (isQueued ? " is-queued" : "")} key={tst.filename}>
                      <div className="avail-item-info">
                        <p className="test-name">{tst.alias || tst.name}</p>
                        <span className={`badge-type ${badgeClass(tst.type)}`}>{tst.typeLabel}</span>
                        {environmentBadge(tst)}
                      </div>
                      {isQueued ? (
                        <button className="btn-remove-avail" title={t("btn_remove_from_queue_title")} onClick={() => removeFromQueue(tst.filename)}>
                          ×
                        </button>
                      ) : (
                        <button className="btn-add-queue" title={t("btn_add_to_queue_title")} onClick={() => addToQueue(tst)}>
                          +
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : allGroups.length === 0 ? (
              <div className="groups-tab-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 16 16" style={{ opacity: 0.25 }}>
                  <path d="M.5 3l.04.87a1.99 1.99 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14h10.348a2 2 0 0 0 1.991-1.819l.637-7A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2zm5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19c-.24 0-.47.042-.683.12L1.5 2.98a1 1 0 0 1 1-.98h3.672z" />
                </svg>
                <p>{t("group_no_groups_created")}</p>
                <a href="/groups">{t("group_manage_link")}</a>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="groups-tab-empty">
                <p>{t("group_no_match")}</p>
              </div>
            ) : (
              filteredGroups.map((g) => {
                const realIdx = allGroups.indexOf(g);
                const col = GROUP_COLORS[realIdx % GROUP_COLORS.length];
                const knownTests = g.tests.filter((fn) => allTests.some((tst) => tst.filename === fn));
                const alreadyQueued = knownTests.filter((fn) => queueSet.has(fn)).length;
                const addable = knownTests.length - alreadyQueued;
                return (
                  <div className="group-queue-item" key={g.id}>
                    <div className="group-queue-info">
                      <span className="group-queue-dot" style={{ background: col.text }} />
                      <div className="group-queue-text">
                        <p className="group-queue-name">{g.name}</p>
                        <span className="group-queue-meta">
                          {knownTests.length} test{knownTests.length !== 1 ? "s" : ""}
                          {alreadyQueued > 0 ? ` · ${alreadyQueued} ${t("group_already_in_queue")}` : ""}
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn-add-group-queue"
                      disabled={addable === 0}
                      style={addable === 0 ? { opacity: 0.4, cursor: "default" } : {}}
                      onClick={() => addGroupToQueue(g.id)}
                    >
                      {addable === 0 ? t("group_all_added") : t("group_add_all")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="panel panel-queue">
          <div className="panel-header panel-header-row">
            <div className="d-flex align-items-center gap-3">
              <h2 className="panel-title">{t("panel_queue_title")}</h2>
              <button className="btn btn-primary btn-sm btn-run-all" onClick={runQueue}>
                {t("btn_run_queue")}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm btn-reset-queue"
                disabled={isAnyRunning || queue.length === 0}
                title={t("btn_reset_queue_title")}
                onClick={resetQueue}
              >
                {t("btn_reset_queue")}
              </button>
            </div>
            <span className="queue-count">{queueLabel}</span>
          </div>
          <div className="panel-body" ref={queueListRef} onDragOver={onQueueDragOver}>
            {queue.length === 0 ? (
              <div className="queue-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ opacity: 0.25 }}>
                  <path d="M2.5 3a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1zm8-6h1a1 1 0 0 1 1 1v1h1a.5.5 0 0 1 .354.854l-2 2a.5.5 0 0 1-.708 0l-2-2A.5.5 0 0 1 9.5 7h1V6a1 1 0 0 1 1-1" />
                </svg>
                <p>{t("queue_empty_message")}</p>
              </div>
            ) : (
              queue.map((tst) => {
                const status = statusRef.current[tst.filename] || "idle";
                const output = outputRef.current[tst.filename] || "";
                const isDragging = draggingFilename === tst.filename;
                const statusLabels: Record<string, string> = {
                  idle: t("status_idle"),
                  running: t("status_running"),
                  passed: t("status_passed"),
                  failed: t("status_failed"),
                };
                return (
                  <div
                    className={"test-card" + (status !== "idle" ? " is-" + status : "") + (isDragging ? " is-dragging" : "")}
                    id={cardId(tst.filename)}
                    data-filename={tst.filename}
                    draggable
                    key={tst.filename}
                    onDragStart={() => onDragStart(tst.filename)}
                    onDragEnd={onDragEnd}
                  >
                    <div className="test-card-body">
                      <div className="test-card-top">
                        <div className="d-flex align-items-center gap-3">
                          <span className="drag-handle" title={t("drag_handle_title")}>
                            ⠿
                          </span>
                          <div>
                            <p className="test-name">{tst.alias || tst.name}</p>
                            <div className="test-badges">
                              <span className={`badge-type ${badgeClass(tst.type)}`}>{tst.typeLabel}</span>
                              {tst.estimatedMs ? <span className="badge-est">~{formatDuration(tst.estimatedMs)}</span> : null}
                              {environmentBadge(tst)}
                            </div>
                          </div>
                        </div>
                        <div className="test-actions">
                          <span className="status-pill" style={{ display: status === "idle" ? "none" : "" }}>
                            {statusLabels[status] || status}
                          </span>
                          <button className="btn btn-primary btn-sm btn-run" disabled={status === "running"} onClick={() => runTest(tst)}>
                            {status === "running" ? <span className="spinner-border spinner-xs" role="status" /> : t("btn_run")}
                          </button>
                          <button className="btn-remove-queue" title={t("btn_remove_from_queue_title")} onClick={() => removeFromQueue(tst.filename)}>
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                    {output && (
                      <div className="output-area visible" draggable={false}>
                        <div className="output-toolbar">
                          <button
                            type="button"
                            className="btn-copy-output"
                            title={t("btn_copy_output_title")}
                            onClick={() => copyOutput(tst.filename)}
                          >
                            {copiedFilename === tst.filename ? t("btn_copy_output_done") : t("btn_copy_output_title")}
                          </button>
                        </div>
                        <pre className="output-pre" draggable={false}>{output}</pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {resultsModal && (
        <div
          className="results-overlay"
          style={{ display: "flex" }}
          onClick={(e) => e.target === e.currentTarget && setResultsModal(null)}
        >
          <div className="results-dialog">
            <div className="results-dialog-header">
              <h2 className="results-title">{t("results_title")}</h2>
              <button className="results-close-btn" aria-label={t("results_close_aria")} onClick={() => setResultsModal(null)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body">
              <div className="results-stats-grid">
                <div className="results-stat-card is-neutral">
                  <div className="stat-val">{resultsModal.launched}</div>
                  <div className="stat-lbl">{t("stat_launched")}</div>
                </div>
                <div className="results-stat-card is-success">
                  <div className="stat-val">{resultsModal.passed}</div>
                  <div className="stat-lbl">{t("stat_passed")}</div>
                </div>
                <div className="results-stat-card is-danger">
                  <div className="stat-val">{resultsModal.failed}</div>
                  <div className="stat-lbl">{t("stat_failed")}</div>
                </div>
                <div className="results-stat-card is-time">
                  <div className="stat-val">{resultsModal.timeStr}</div>
                  <div className="stat-lbl">{t("stat_total_duration")}</div>
                </div>
              </div>
              {resultsModal.failedTests.length > 0 ? (
                <>
                  <div className="results-failures-title">
                    {resultsModal.failedTests.length}{" "}
                    {resultsModal.failedTests.length > 1 ? t("stat_failed").toLowerCase() : t("stat_failed").toLowerCase().replace(/s$/, "")}
                  </div>
                  {resultsModal.failedTests.map((tst, i) => {
                    const a = resultsModal.failingActions[i];
                    const err = resultsModal.failureErrors[i];
                    return (
                      <div className="results-failure-item" key={tst.filename}>
                        <div className="results-failure-name">{tst.alias || tst.name}</div>
                        {a && (
                          <div className="results-failure-action">
                            {t("results_failed_step_prefix")} <strong>{a.index}</strong> — {a.description}
                          </div>
                        )}
                        {err && <pre className="results-failure-error">{err}</pre>}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="results-all-passed">{t("results_all_passed")}</div>
              )}
            </div>
            <div className="results-dialog-footer">
              {resultsModal.sessionTests.length > 0 && (
                <a className="btn btn-outline-secondary btn-sm" href="/screenshots?f=all" target="_blank" rel="noreferrer">
                  {t("results_view_all_screenshots")}
                </a>
              )}
              {resultsModal.failedTests.length > 0 && (
                <a className="btn btn-outline-danger btn-sm" href="/screenshots?f=failed" target="_blank" rel="noreferrer">
                  {t("results_view_failed_screenshots")}
                </a>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setResultsModal(null)}>
                {t("btn_close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
