import { useEffect, useRef, useState, type DragEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faList, faWrench, faFolderOpen, faPlay, faPause, faStop, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { formatDuration, GROUP_COLORS } from "../utils/format";
import { useEnvironment } from "../environment/EnvironmentContext";
import { OutputBlock } from "../components/OutputBlock";
import { useQueue } from "./QueueContext";
import { useCampaignQueue } from "../campaigns/CampaignQueueContext";
import type { Test, Group } from "../types";

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

// The execution queue panel (the right side of the "File d'exécution" tab),
// extracted so the "Liste des tests" tab can embed the exact same queue —
// same QueueContext, so both views always show the same queue state. The
// results and campaign modals travel with it.
export default function QueuePanel() {
  const { t, ready } = useI18n();
  const { selectedId } = useEnvironment();
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
    queueRunning,
    queuePaused,
    pauseQueue,
    resumeQueue,
    stopQueue,
    createCampaign,
  } = useQueue();
  const { isBusy: campaignsBusy } = useCampaignQueue();
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [draggingFilename, setDraggingFilename] = useState<string | null>(null);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
  const [sentToCorrection, setSentToCorrection] = useState<string | null>(null);
  const [campaignCreated, setCampaignCreated] = useState(false);
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [modalGroups, setModalGroups] = useState<Group[] | null>(null);
  const queueListRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // Hydrate queue entries restored (filename-only) from localStorage with
  // full test metadata — this used to live on the old File d'exécution tab;
  // the queue panel now owns it since it's the only queue UI left.
  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    (async () => {
      const tests: Test[] = await apiFetch("/api/tests").then((r) => r.json());
      setAllTests(tests);
      setQueue((prev) => prev.map((tst) => tests.find((x) => x.filename === tst.filename) || tst));
      for (const tst of queue) {
        if (!statusRef.current[tst.filename]) statusRef.current[tst.filename] = "idle";
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const queueSet = new Set(queue.map((tst) => tst.filename));

  // ── "Ajouter depuis des groupes" modal ──

  const openGroupsModal = async () => {
    setGroupsModalOpen(true);
    setModalGroups(null);
    try {
      const [grps, tests] = await Promise.all([
        apiFetch("/api/groups").then((r) => r.json()),
        apiFetch("/api/tests").then((r) => r.json()),
      ]);
      setAllTests(tests);
      setModalGroups(grps);
    } catch {
      setModalGroups([]);
    }
  };

  const addGroupToQueue = (group: Group) => {
    for (const fn of group.tests) {
      const test = allTests.find((tst) => tst.filename === fn);
      if (test && !queueSet.has(fn)) addToQueue(test);
    }
  };

  const copyOutput = async (filename: string) => {
    try {
      await navigator.clipboard.writeText(outputRef.current[filename] || "");
      setCopiedFilename(filename);
      setTimeout(() => setCopiedFilename((f) => (f === filename ? null : f)), 1500);
    } catch {}
  };

  // Drops the test into the corrections pending set (Correction de tests
  // sub-tab), passing along the last run's console output when there is one
  // so the AI opens on the real failure context.
  const sendToCorrection = async (tst: Test) => {
    const res = await apiFetch("/api/corrections", {
      method: "POST",
      body: JSON.stringify({
        filename: tst.filename,
        consoleOutput: outputRef.current[tst.filename] || "",
        environmentId: selectedId,
      }),
    });
    if (!res.ok) return;
    setSentToCorrection(tst.filename);
    setTimeout(() => setSentToCorrection((f) => (f === tst.filename ? null : f)), 1500);
  };

  const handleCreateCampaign = async () => {
    setCampaignModalOpen(false);
    await createCampaign(campaignTitle);
    setCampaignTitle("");
    setCampaignCreated(true);
    setTimeout(() => setCampaignCreated(false), 1500);
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

  const totalMs = queue.reduce((a, tst) => a + (tst.lastSuccessMs ?? tst.estimatedMs ?? 0), 0);
  const knownCount = queue.filter((tst) => tst.lastSuccessMs ?? tst.estimatedMs).length;
  let queueLabel = queue.length === 0 ? "0 test" : `${queue.length} test${queue.length > 1 ? "s" : ""}`;
  if (totalMs > 0) {
    const partial = knownCount < queue.length ? " partiel" : "";
    queueLabel += ` · ~${formatDuration(totalMs)}${partial}`;
  }

  return (
    <>
      <div className="panel panel-queue">
        <div className="panel-header panel-header-row">
          <div className="d-flex align-items-center gap-2">
            <h2 className="panel-title">{t("panel_queue_title")}</h2>
            {!queueRunning ? (
              <button
                className="btn btn-success btn-sm btn-run-all"
                disabled={campaignsBusy || queue.length === 0}
                title={campaignsBusy ? t("campaigns_busy_message") : t("btn_run_queue")}
                onClick={runQueue}
              >
                <FontAwesomeIcon icon={faPlay} style={{ fontSize: 12 }} />
              </button>
            ) : (
              <>
                {queuePaused ? (
                  <button className="btn btn-success btn-sm" title={t("btn_queue_resume_title")} onClick={resumeQueue}>
                    <FontAwesomeIcon icon={faPlay} style={{ fontSize: 12 }} />
                  </button>
                ) : (
                  <button className="btn btn-outline-secondary btn-sm" title={t("btn_queue_pause_title")} onClick={pauseQueue}>
                    <FontAwesomeIcon icon={faPause} style={{ fontSize: 12 }} />
                  </button>
                )}
                <button className="btn btn-outline-danger btn-sm" title={t("btn_queue_stop_title")} onClick={stopQueue}>
                  <FontAwesomeIcon icon={faStop} style={{ fontSize: 12 }} />
                </button>
              </>
            )}
            <button
              className="btn btn-outline-danger btn-sm btn-reset-queue"
              disabled={isAnyRunning || queue.length === 0}
              title={t("btn_reset_queue_title")}
              onClick={resetQueue}
            >
              <FontAwesomeIcon icon={faRotateLeft} style={{ fontSize: 12 }} />
            </button>
            <button className="btn btn-outline-primary btn-sm" title={t("btn_add_from_groups")} onClick={openGroupsModal}>
              <FontAwesomeIcon icon={faFolderOpen} style={{ fontSize: 12 }} />
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              disabled={queue.length === 0}
              title={t("btn_create_campaign_title")}
              onClick={() => {
                setCampaignTitle("");
                setCampaignModalOpen(true);
              }}
            >
              {campaignCreated ? t("btn_create_campaign_done") : t("btn_create_campaign")}
            </button>
          </div>
          <span className="queue-count">{queueLabel}</span>
        </div>
        {campaignsBusy && <p className="queue-busy-hint">{t("campaigns_busy_message")}</p>}
        <div className="panel-body" ref={queueListRef} onDragOver={onQueueDragOver}>
          {queue.length === 0 ? (
            <div className="queue-empty">
              <FontAwesomeIcon icon={faList} style={{ fontSize: 32, opacity: 0.25 }} />
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
                            {(tst.lastSuccessMs ?? tst.estimatedMs) ? (
                              <span className="badge-est">~{formatDuration(tst.lastSuccessMs ?? tst.estimatedMs)}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="test-actions">
                        <span className="status-pill" style={{ display: status === "idle" ? "none" : "" }}>
                          {statusLabels[status] || status}
                        </span>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          disabled={status === "running"}
                          title={t("btn_send_to_correction_title")}
                          onClick={() => sendToCorrection(tst)}
                        >
                          {sentToCorrection === tst.filename ? "✓" : <FontAwesomeIcon icon={faWrench} style={{ fontSize: 11 }} />}
                        </button>
                        <button
                          className="btn btn-primary btn-sm btn-run"
                          disabled={status === "running" || campaignsBusy}
                          title={campaignsBusy ? t("campaigns_busy_message") : undefined}
                          onClick={() => runTest(tst)}
                        >
                          {status === "running" ? <span className="spinner-border spinner-xs" role="status" /> : t("btn_run")}
                        </button>
                        <button className="btn-remove-queue" title={t("btn_remove_from_queue_title")} onClick={() => removeFromQueue(tst.filename)}>
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                  {output && (
                    <OutputBlock output={output} copied={copiedFilename === tst.filename} onCopy={() => copyOutput(tst.filename)} />
                  )}
                </div>
              );
            })
          )}
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
              <button className="btn btn-primary btn-sm" onClick={() => setResultsModal(null)}>
                {t("btn_close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {groupsModalOpen && (
        <div
          className="results-overlay"
          style={{ display: "flex" }}
          onClick={(e) => e.target === e.currentTarget && setGroupsModalOpen(false)}
        >
          <div className="results-dialog" style={{ maxWidth: 480 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_add_groups_title")}</h2>
              <button className="results-close-btn" onClick={() => setGroupsModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1rem 1.5rem" }}>
              {modalGroups === null ? (
                <p className="correction-chat-hint">{t("loading")}</p>
              ) : modalGroups.length === 0 ? (
                <div className="groups-tab-empty">
                  <FontAwesomeIcon icon={faFolderOpen} style={{ fontSize: 28, opacity: 0.25 }} />
                  <p>{t("group_no_groups_created")}</p>
                  <a href="/groups">{t("group_manage_link")}</a>
                </div>
              ) : (
                modalGroups.map((g, idx) => {
                  const col = GROUP_COLORS[idx % GROUP_COLORS.length];
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
                        onClick={() => addGroupToQueue(g)}
                      >
                        {addable === 0 ? t("group_all_added") : t("group_add_all")}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-primary btn-sm" onClick={() => setGroupsModalOpen(false)}>
                {t("btn_close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {campaignModalOpen && (
        <div
          className="results-overlay"
          style={{ display: "flex" }}
          onClick={(e) => e.target === e.currentTarget && setCampaignModalOpen(false)}
        >
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_create_campaign_title")}</h2>
              <button className="results-close-btn" onClick={() => setCampaignModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("campaign_title_label")}</label>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder={t("campaign_title_placeholder")}
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCampaign();
                }}
              />
              <p style={{ margin: "0.9rem 0 0" }}>{t("campaign_create_confirm_count").replace("{n}", String(queue.length))}</p>
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setCampaignModalOpen(false)}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleCreateCampaign}>
                {t("btn_create_campaign")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
