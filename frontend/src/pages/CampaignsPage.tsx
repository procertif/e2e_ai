import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlay, faPause, faStop, faClock, faPenToSquare, faTrash } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import { RepoUpdateBanner, RepoUpdateIcon } from "../environment/RepoUpdateBanner";
import { OutputBlock } from "../components/OutputBlock";
import { useCampaignQueue } from "../campaigns/CampaignQueueContext";
import { useQueue } from "../queue/QueueContext";
import { environmentColorHex } from "../utils/environmentColors";
import { formatDuration } from "../utils/format";
import type { Campaign, Test } from "../types";
import "../styles/groups.css";
import "../styles/environments.css";
import "../styles/logs.css";
import "../styles/campaigns.css";

interface RenameModalState {
  id: string;
  value: string;
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
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
}

export default function CampaignsPage() {
  const { t, ready, lang } = useI18n();
  const navigate = useNavigate();
  const { environments, selectedId: envSelectedId, setSelectedId: setEnvSelectedId, selectedEnvironment } = useEnvironment();
  const {
    selectedId,
    setSelectedId,
    runningCampaignId,
    queuedCampaignIds,
    liveStatus,
    liveOutput,
    finishedCampaigns,
    pausedCampaigns,
    requestRelaunch,
    requestPause,
    requestStop,
    requestResume,
  } = useCampaignQueue();
  const { isAnyRunning: testsRunning } = useQueue();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
  const [renameModal, setRenameModal] = useState<RenameModalState | null>(null);
  const [dotCount, setDotCount] = useState(1);
  const [relaunchMenuOpen, setRelaunchMenuOpen] = useState(false);
  const relaunchMenuRef = useRef<HTMLDivElement>(null);
  const [proposingCorrection, setProposingCorrection] = useState(false);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [camps, tests] = await Promise.all([
        apiFetch("/api/campaigns").then((r) => r.json()),
        apiFetch("/api/tests").then((r) => r.json()),
      ]);
      setCampaigns(camps);
      setAllTests(tests);
    })();
  }, [ready]);

  const isBusy = runningCampaignId != null || queuedCampaignIds.length > 0;

  useEffect(() => {
    if (!isBusy) {
      setDotCount(1);
      return;
    }
    const interval = setInterval(() => setDotCount((d) => (d % 3) + 1), 450);
    return () => clearInterval(interval);
  }, [isBusy]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!renameModal) return;
      if (e.key === "Escape") setRenameModal(null);
      if (e.key === "Enter") saveRenameModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameModal]);

  useEffect(() => {
    if (!relaunchMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (relaunchMenuRef.current && !relaunchMenuRef.current.contains(e.target as Node)) setRelaunchMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRelaunchMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [relaunchMenuOpen]);

  // Live results (running/queued) take priority over the last fetch of /api/campaigns,
  // which may be stale if a relaunch finished while this page wasn't mounted.
  const displayCampaigns = campaigns?.map((c) => finishedCampaigns[c.id] ?? c) ?? null;
  const selected = displayCampaigns?.find((c) => c.id === selectedId) || null;

  const displayTitle = (c: Campaign) => c.title || t("campaign_untitled_prefix") + " " + fmtDate(c.createdAt, lang);

  const testInfo = (filename: string) => allTests.find((x) => x.filename === filename);

  const selectCampaign = (id: string) => setSelectedId(id);

  const openRenameModal = (campaign: Campaign) => {
    setRenameModal({ id: campaign.id, value: campaign.title || "" });
  };

  const closeRenameModal = () => setRenameModal(null);

  const saveRenameModal = async () => {
    if (!renameModal) return;
    const { id, value } = renameModal;
    setRenameModal(null);
    const campaign = campaigns?.find((c) => c.id === id);
    const title = value.trim();
    if (!campaign || title === (campaign.title || "")) return;
    try {
      const res = await apiFetch(`/api/campaigns/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const updated: Campaign = await res.json();
        setCampaigns((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev));
      }
    } catch {}
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm(t("campaign_delete_confirm"))) return;
    try {
      await apiFetch(`/api/campaigns/${id}`, { method: "DELETE" });
      setCampaigns((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      if (selectedId === id) setSelectedId(null);
    } catch {}
  };

  const handleStart = (campaign: Campaign, mode: "all" | "failed") => {
    setRelaunchMenuOpen(false);
    requestRelaunch(campaign, mode);
  };

  const proposeCorrection = async (campaign: Campaign) => {
    setProposingCorrection(true);
    try {
      const res = await apiFetch(`/api/campaigns/${campaign.id}/correction`, { method: "POST" });
      if (res.ok) {
        const tests: { filename: string }[] = await res.json();
        navigate(tests[0] ? `/?tab=corrections&filename=${encodeURIComponent(tests[0].filename)}` : "/?tab=corrections");
      }
    } finally {
      setProposingCorrection(false);
    }
  };

  const copyOutput = async (campaignId: string, filename: string) => {
    try {
      await navigator.clipboard.writeText(liveOutput[campaignId]?.[filename] || "");
      setCopiedFilename(filename);
      setTimeout(() => setCopiedFilename((f) => (f === filename ? null : f)), 1500);
    } catch {}
  };

  const statusLabels: Record<string, string> = {
    idle: t("status_idle"),
    running: t("status_running"),
    passed: t("status_passed"),
    failed: t("status_failed"),
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("campaigns_page_title")}</h1>
        <span className="badge-env">CAMPAGNES</span>
      </div>

      <div className="app-content">
        <RepoUpdateBanner environment={selectedEnvironment} />
        <div className="panels-layout">
          <div className="panel panel-available">
            <div className="panel-header">
              <div className="d-flex align-items-center justify-content-between">
                <h2 className="panel-title">{t("panel_campaigns_title")}</h2>
                <span className="avail-count">{displayCampaigns?.length ?? 0}</span>
              </div>
            </div>
            <div className="panel-body">
              {displayCampaigns === null && <div className="groups-tab-empty"><p>{t("campaigns_loading")}</p></div>}
              {displayCampaigns?.length === 0 && (
                <div className="groups-tab-empty">
                  <FontAwesomeIcon icon={faClock} style={{ fontSize: 28, opacity: 0.25 }} />
                  <p>{t("campaigns_empty_message")}</p>
                </div>
              )}
              {displayCampaigns?.map((c) => {
                const isRunning = c.id === runningCampaignId;
                const isQueued = queuedCampaignIds.includes(c.id);
                const isPaused = Boolean(pausedCampaigns[c.id]?.length);
                return (
                  <div className={"log-item" + (c.id === selectedId ? " active" : "")} key={c.id} onClick={() => selectCampaign(c.id)}>
                    <div className="log-item-top">
                      <span className="campaign-list-title">{displayTitle(c)}</span>
                      {isRunning && (
                        <span className="campaign-progress">
                          <span className="spinner-border spinner-xs" role="status" />
                          <span className="campaign-progress-text">{t("campaign_running_label")}</span>
                          <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                        </span>
                      )}
                      {isQueued && (
                        <span className="campaign-progress is-queued">
                          <span className="spinner-border spinner-xs" role="status" />
                          <span className="campaign-progress-text">{t("campaign_queued_label")}</span>
                          <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                        </span>
                      )}
                      {isPaused && !isRunning && !isQueued && (
                        <span className="campaign-progress is-paused">
                          <span className="campaign-progress-text">{t("campaign_paused_label")}</span>
                        </span>
                      )}
                      {!isRunning && !isQueued && !isPaused && (
                        <span className="log-item-actions">
                          <button
                            className="log-rename-btn"
                            title={t("btn_rename_title")}
                            onClick={(e) => {
                              e.stopPropagation();
                              openRenameModal(c);
                            }}
                          >
                            <FontAwesomeIcon icon={faPenToSquare} style={{ fontSize: 12 }} />
                          </button>
                          <button
                            className="log-delete-btn"
                            title={t("btn_delete_title")}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCampaign(c.id);
                            }}
                          >
                            <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="log-item-date">{fmtDate(c.createdAt, lang)}</div>
                    <div className="log-item-stats">
                      {!isRunning && !isQueued && (
                        <>
                          <span className="campaign-result-badge campaign-result-passed">{c.passed} ✓</span>
                          {c.failed > 0 && <span className="campaign-result-badge campaign-result-failed">{c.failed} ✗</span>}
                        </>
                      )}
                    </div>
                    {isRunning &&
                      (() => {
                        const progress = liveStatus[c.id] || {};
                        const total = Object.keys(progress).length;
                        const done = Object.values(progress).filter((s) => s !== "running").length;
                        return (
                          <div className="campaign-progress-row">
                            <div className="campaign-progress-bar-track">
                              <div
                                className="campaign-progress-bar-fill"
                                style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
                              />
                            </div>
                            <span className="campaign-progress-count">
                              {done}/{total} {t("campaign_tests_done_label")}
                            </span>
                          </div>
                        );
                      })()}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel panel-queue">
            {!selected ? (
              <div className="panel-body">
                <div className="queue-empty">
                  <p>{t("campaign_select_prompt")}</p>
                </div>
              </div>
            ) : (
              (() => {
                const isRunning = selected.id === runningCampaignId;
                const isQueued = queuedCampaignIds.includes(selected.id);
                const isPaused = Boolean(pausedCampaigns[selected.id]?.length);
                const live = liveStatus[selected.id];
                return (
                  <>
                    <div className="panel-header panel-header-row">
                      <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                        <h2 className="panel-title campaign-title-static">{displayTitle(selected)}</h2>
                        {isRunning ? (
                          <>
                            <span className="campaign-progress">
                              <span className="spinner-border spinner-xs" role="status" />
                              <span className="campaign-progress-text">{t("campaign_running_label")}</span>
                              <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                            </span>
                            <button className="btn btn-outline-secondary btn-sm" onClick={() => requestPause(selected.id)}>
                              <PauseIcon /> {t("btn_pause_campaign")}
                            </button>
                            <button className="btn btn-outline-danger btn-sm" onClick={() => requestStop(selected.id)}>
                              <StopIcon /> {t("btn_stop_campaign")}
                            </button>
                          </>
                        ) : isQueued ? (
                          <span className="campaign-progress is-queued">
                            <span className="spinner-border spinner-xs" role="status" />
                            <span className="campaign-progress-text">{t("campaign_queued_label")}</span>
                            <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                          </span>
                        ) : isPaused ? (
                          <>
                            <span className="campaign-progress is-paused">
                              <span className="campaign-progress-text">{t("campaign_paused_label")}</span>
                            </span>
                            <button
                              className="btn btn-success btn-sm"
                              disabled={!selectedEnvironment || testsRunning}
                              title={testsRunning ? t("tests_busy_message") : !selectedEnvironment ? t("campaign_no_target_environment") : undefined}
                              onClick={() => requestResume(selected)}
                            >
                              <PlayIcon /> {t("btn_resume_campaign")}
                            </button>
                          </>
                        ) : selected.failed > 0 ? (
                          <div className="btn-group" ref={relaunchMenuRef} style={{ position: "relative" }}>
                            <button
                              className="btn btn-success btn-sm"
                              disabled={!selectedEnvironment || testsRunning}
                              title={testsRunning ? t("tests_busy_message") : !selectedEnvironment ? t("campaign_no_target_environment") : undefined}
                              onClick={() => handleStart(selected, "all")}
                            >
                              <PlayIcon /> {t("btn_start_campaign")}
                            </button>
                            <button
                              type="button"
                              className="btn btn-success btn-sm dropdown-toggle dropdown-toggle-split"
                              disabled={!selectedEnvironment || testsRunning}
                              title={testsRunning ? t("tests_busy_message") : undefined}
                              onClick={() => setRelaunchMenuOpen((o) => !o)}
                            >
                              <span className="visually-hidden">{t("btn_start_campaign_options")}</span>
                            </button>
                            {relaunchMenuOpen && (
                              <ul className="dropdown-menu show" style={{ position: "absolute", top: "100%", right: 0 }}>
                                <li>
                                  <button className="dropdown-item" onClick={() => handleStart(selected, "failed")}>
                                    {t("btn_start_failed_tests")}
                                  </button>
                                </li>
                              </ul>
                            )}
                          </div>
                        ) : null}
                        {!isRunning && !isQueued && !isPaused && selected.failed > 0 && (
                          <button className="btn btn-outline-secondary btn-sm" disabled={proposingCorrection} onClick={() => proposeCorrection(selected)}>
                            {proposingCorrection && <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />} {t("btn_propose_correction")}
                          </button>
                        )}
                        {isRunning || isQueued || isPaused || selected.failed > 0 ? null : (
                          <button
                            className="btn btn-success btn-sm"
                            disabled={!selectedEnvironment || testsRunning}
                            title={testsRunning ? t("tests_busy_message") : !selectedEnvironment ? t("campaign_no_target_environment") : undefined}
                            onClick={() => handleStart(selected, "all")}
                          >
                            <PlayIcon /> {t("btn_start_campaign")}
                          </button>
                        )}
                      </div>
                      <div className="d-flex align-items-center gap-3">
                        <div className="d-flex align-items-center gap-2">
                          <span className="environment-color-dot" style={{ background: selectedEnvironment ? environmentColorHex(selectedEnvironment.color) : "#ced4da" }} />
                          <select
                            className="form-select form-select-sm target-environment-select"
                            value={envSelectedId ?? ""}
                            disabled={isRunning}
                            onChange={(e) => setEnvSelectedId(Number(e.target.value))}
                          >
                            {environments.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                          <RepoUpdateIcon environment={selectedEnvironment} />
                        </div>
                        <span className="queue-count">
                          {selected.passed}/{selected.total} · {selected.durationMs != null ? `~${formatDuration(selected.durationMs)}` : "—"}
                        </span>
                      </div>
                    </div>
                    {testsRunning && !isRunning && !isQueued && <p className="queue-busy-hint">{t("tests_busy_message")}</p>}
                    <div className="panel-body">
                      {selected.tests.map((tst) => {
                        const status = live?.[tst.filename] ?? tst.status;
                        const info = testInfo(tst.filename);
                        const output = liveOutput[selected.id]?.[tst.filename] || "";
                        return (
                          <div className={"test-card is-" + status} key={tst.filename}>
                            <div className="test-card-body">
                              <div className="test-card-top">
                                <div className="d-flex align-items-center gap-3">
                                  <div>
                                    <p className="test-name">{info?.alias || info?.name || tst.filename}</p>
                                  </div>
                                </div>
                                <div className="test-actions">
                                  <span className="status-pill">{statusLabels[status] || status}</span>
                                </div>
                              </div>
                            </div>
                            {output && (
                              <OutputBlock output={output} copied={copiedFilename === tst.filename} onCopy={() => copyOutput(selected.id, tst.filename)} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>

      {renameModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeRenameModal()}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_rename_campaign_title")}</h2>
              <button className="results-close-btn" onClick={closeRenameModal}>
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
                value={renameModal.value}
                onChange={(e) => setRenameModal({ ...renameModal, value: e.target.value })}
              />
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeRenameModal}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveRenameModal}>
                {t("btn_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
