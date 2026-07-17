import { useEffect, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faList, faPlus, faWrench, faTrash, faPen, faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import { environmentColorHex } from "../utils/environmentColors";
import { fuzzyMatch, formatDuration, filenameToFolder, renderGherkin, GROUP_COLORS } from "../utils/format";
import QueuePanel from "../queue/QueuePanel";
import { useQueue } from "../queue/QueueContext";
import type { Test, Group } from "../types";
import "../styles/groups.css";
import "../styles/logs.css";
import "../styles/campaigns.css";
import "../styles/screenshots.css";
import "../styles/corrections.css";
import "../styles/scenarios.css";
import "../styles/environments.css";

type ListTab = "metadata" | "scenario" | "screenshots";

interface TestScreenshot {
  url: string;
  file: string;
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

// "Liste des tests" sub-tab of the Tests page: read-only browser over the
// existing tests — metadata, linked scenario spec and screenshots. No AI, no
// editing; the other sub-tabs are for that.
export default function TestsListView() {
  const { t, ready, lang } = useI18n();
  const { environments, selectedId } = useEnvironment();
  const { queue, addToQueue } = useQueue();
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Test | null>(null);
  // Top-level menu of the right column: test details vs the (shared)
  // execution queue.
  const [rightTab, setRightTab] = useState<"info" | "queue">("info");
  const [activeTab, setActiveTab] = useState<ListTab>("metadata");
  const [spec, setSpec] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<TestScreenshot[]>([]);
  const [sentToCorrection, setSentToCorrection] = useState<string | null>(null);
  // Inline title (alias) edition in the Métadonnée tab — null when not editing.
  const [editTitle, setEditTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [tests, groups] = await Promise.all([
        apiFetch("/api/tests").then((r) => r.json()),
        apiFetch("/api/groups").then((r) => r.json()),
      ]);
      setAllTests(tests);
      setAllGroups(groups);
    })();
  }, [ready]);

  const queueSet = new Set(queue.map((tst) => tst.filename));

  const sendToCorrection = async (tst: Test) => {
    const res = await apiFetch("/api/corrections", {
      method: "POST",
      body: JSON.stringify({ filename: tst.filename, environmentId: selectedId }),
    });
    if (!res.ok) return;
    setSentToCorrection(tst.filename);
    setTimeout(() => setSentToCorrection((f) => (f === tst.filename ? null : f)), 1500);
  };

  // Deletes the test and everything attached to it (spec file, scenario,
  // screenshots, aliases, groups membership, run history — see backend
  // deleteTest).
  const deleteTest = async (tst: Test) => {
    if (!confirm(`${t("test_delete_confirm_prefix")} « ${tst.alias || tst.name} » ?`)) return;
    const testkey = tst.filename.replace(/\.spec\.ts$/, "");
    await apiFetch("/api/tests/" + encodeURIComponent(testkey), { method: "DELETE" });
    setAllTests((prev) => prev.filter((x) => x.filename !== tst.filename));
    if (selected?.filename === tst.filename) setSelected(null);
  };

  const saveTitle = async () => {
    if (!selected || editTitle === null) return;
    const alias = editTitle.trim();
    const testkey = selected.filename.replace(/\.spec\.ts$/, "");
    await apiFetch("/api/test-aliases/" + encodeURIComponent(testkey), {
      method: "PUT",
      body: JSON.stringify({ alias }),
    });
    setAllTests((prev) => prev.map((x) => (x.filename === selected.filename ? { ...x, alias: alias || undefined } : x)));
    setSelected((s) => (s ? { ...s, alias: alias || undefined } : s));
    setEditTitle(null);
  };

  const selectTest = (tst: Test) => {
    setSelected(tst);
    setActiveTab("metadata");
    setEditTitle(null);
    setSpec(null);
    setScreenshots([]);
    const testname = tst.filename.replace(/\.spec\.ts$/, "");
    apiFetch(`/api/spec/${encodeURIComponent(testname)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSpec(data?.spec || null))
      .catch(() => {});
    const folder = filenameToFolder(tst.filename);
    apiFetch("/api/screenshots")
      .then((r) => r.json())
      .then((groups: { folder: string; screenshots: TestScreenshot[] }[]) => {
        setScreenshots(groups.find((g) => g.folder === folder)?.screenshots || []);
      })
      .catch(() => {});
  };

  const filtered = allTests.filter((tst) => fuzzyMatch(tst.alias || tst.name, query));

  // Colored environment badge for the list cards — last run environment,
  // falling back to the environment the test was generated for.
  const envBadge = (tst: Test) => {
    const envId = tst.lastEnvironmentId ?? tst.environmentId ?? null;
    const env = envId != null ? environments.find((e) => e.id === envId) : undefined;
    const envName = env?.name || tst.lastEnvironmentName || tst.environmentName;
    if (!envName) return null;
    return (
      <span className="test-list-badge test-env-badge">
        <span className="environment-color-dot" style={{ background: env ? environmentColorHex(env.color) : "#ced4da" }} />
        {envName}
      </span>
    );
  };
  const selectedGroups = selected ? allGroups.filter((g) => g.tests.includes(selected.filename)) : [];

  // Last-run environment badge: the stored id resolves to the live
  // environment for its current color; a deleted environment keeps its
  // stored name with a neutral dot.
  const lastEnv = selected?.lastEnvironmentId != null ? environments.find((e) => e.id === selected.lastEnvironmentId) || null : null;
  const lastEnvName = lastEnv?.name || selected?.lastEnvironmentName || null;

  // "Durée de la dernière exécution réussie" — falls back to the current
  // estimate (average of recent runs) for tests that predate the metadata
  // store.
  const lastSuccessMs = selected?.lastSuccessMs ?? selected?.estimatedMs ?? null;

  const metaRows: { label: string; value: ReactNode }[] = selected
    ? [
        { label: t("meta_filename"), value: selected.filename },
        {
          label: t("meta_title"),
          value:
            editTitle !== null ? (
              <span className="d-flex align-items-center gap-2">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  style={{ maxWidth: 320 }}
                  autoFocus
                  maxLength={120}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") setEditTitle(null);
                  }}
                />
                <button className="btn btn-success btn-sm" onClick={saveTitle}>
                  <FontAwesomeIcon icon={faCheck} style={{ fontSize: 11 }} />
                </button>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setEditTitle(null)}>
                  <FontAwesomeIcon icon={faXmark} style={{ fontSize: 11 }} />
                </button>
              </span>
            ) : (
              <span className="d-flex align-items-center justify-content-between gap-2" style={{ width: "100%" }}>
                {selected.alias || selected.name}
                <button
                  className="test-action-btn"
                  title={t("meta_rename_title")}
                  onClick={() => setEditTitle(selected.alias || selected.name)}
                >
                  <FontAwesomeIcon icon={faPen} style={{ fontSize: 11 }} />
                </button>
              </span>
            ),
        },
        { label: t("meta_last_success_duration"), value: lastSuccessMs ? `~${formatDuration(lastSuccessMs)}` : "—" },
        {
          label: t("meta_last_environment"),
          value: lastEnvName ? (
            <span className="test-list-badge test-env-badge">
              <span className="environment-color-dot" style={{ background: lastEnv ? environmentColorHex(lastEnv.color) : "#ced4da" }} />
              {lastEnvName}
            </span>
          ) : (
            "—"
          ),
        },
        {
          label: t("meta_groups"),
          value: selectedGroups.length ? (
            <span className="test-meta-badges">
              {selectedGroups.map((g) => {
                const col = GROUP_COLORS[allGroups.indexOf(g) % GROUP_COLORS.length];
                return (
                  <span className="test-list-badge" style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }} key={g.id}>
                    {g.name}
                  </span>
                );
              })}
            </span>
          ) : (
            "—"
          ),
        },
        { label: t("meta_created_at"), value: selected.createdAt ? fmtDate(selected.createdAt, lang) : "—" },
        { label: t("meta_updated_at"), value: selected.updatedAt ? fmtDate(selected.updatedAt, lang) : "—" },
      ]
    : [];

  return (
    <div className="panels-layout corrections-layout">
      <div className="panel panel-available">
        <div className="panel-header">
          <div className="d-flex align-items-center justify-content-between">
            <h2 className="panel-title">{t("tests_list_panel_title")}</h2>
            <span className="avail-count">
              {filtered.length !== allTests.length ? `${filtered.length}/${allTests.length} tests` : `${allTests.length} tests`}
            </span>
          </div>
          <div className="panel-search-wrap">
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: 13 }} />
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
          {filtered.map((tst) => {
            return (
              <div
                key={tst.filename}
                className={"log-item" + (selected?.filename === tst.filename ? " active" : "")}
                onClick={() => selectTest(tst)}
              >
                <div className="log-item-top">
                  <span className="campaign-list-title" title={tst.filename}>{tst.alias || tst.name}</span>
                  <span className="log-item-actions">
                    {queueSet.has(tst.filename) ? (
                      <button className="test-action-btn" disabled title={t("tests_list_already_queued")} style={{ opacity: 0.35, cursor: "default" }}>
                        <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} />
                      </button>
                    ) : (
                      <button
                        className="test-action-btn"
                        title={t("btn_add_to_queue_title")}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToQueue(tst);
                        }}
                      >
                        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 12 }} />
                      </button>
                    )}
                    <button
                      className="test-action-btn"
                      title={t("btn_send_to_correction_title")}
                      onClick={(e) => {
                        e.stopPropagation();
                        sendToCorrection(tst);
                      }}
                    >
                      {sentToCorrection === tst.filename ? (
                        <FontAwesomeIcon icon={faCheck} style={{ fontSize: 12 }} />
                      ) : (
                        <FontAwesomeIcon icon={faWrench} style={{ fontSize: 12 }} />
                      )}
                    </button>
                    <button
                      className="test-action-btn"
                      title={t("btn_delete_title")}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTest(tst);
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
                    </button>
                  </span>
                </div>
                <div className="correction-indicators">
                  {(tst.lastSuccessMs ?? tst.estimatedMs) ? (
                    <span className="badge-est">~{formatDuration(tst.lastSuccessMs ?? tst.estimatedMs)}</span>
                  ) : null}
                  {envBadge(tst)}
                  {allGroups
                    .filter((g) => g.tests.includes(tst.filename))
                    .map((g) => {
                      const col = GROUP_COLORS[allGroups.indexOf(g) % GROUP_COLORS.length];
                      return (
                        <span className="test-list-badge" style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }} key={g.id}>
                          {g.name}
                        </span>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tests-right-col">
        <div className="correction-tabs tests-right-menu">
          <button className={"correction-tab" + (rightTab === "info" ? " is-active" : "")} onClick={() => setRightTab("info")}>
            {t("tests_list_top_info")}
          </button>
          <button className={"correction-tab" + (rightTab === "queue" ? " is-active" : "")} onClick={() => setRightTab("queue")}>
            {t("tests_tab_queue")}
          </button>
        </div>
        {rightTab === "queue" ? (
          <QueuePanel />
        ) : (
      <div className="panel panel-queue corrections-editor-panel">
        {!selected ? (
          <div className="panel-body">
            <div className="queue-empty">
              <FontAwesomeIcon icon={faList} style={{ fontSize: 32, opacity: 0.25 }} />
              <p>{t("tests_list_select_prompt")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="panel-header panel-header-row">
              <h2 className="panel-title campaign-title-static" title={selected.filename}>{selected.alias || selected.name}</h2>
            </div>
            <div className="correction-tabs">
              <button className={"correction-tab" + (activeTab === "metadata" ? " is-active" : "")} onClick={() => setActiveTab("metadata")}>
                {t("tests_list_tab_metadata")}
              </button>
              <button className={"correction-tab" + (activeTab === "scenario" ? " is-active" : "")} onClick={() => setActiveTab("scenario")}>
                {t("correction_tab_scenario")}
              </button>
              <button className={"correction-tab" + (activeTab === "screenshots" ? " is-active" : "")} onClick={() => setActiveTab("screenshots")}>
                {t("correction_tab_screenshots")} {screenshots.length > 0 && `(${screenshots.length})`}
              </button>
            </div>
            {activeTab === "metadata" && (
              <div className="test-meta-body">
                <table className="test-meta-table">
                  <tbody>
                    {metaRows.map((row) => (
                      <tr key={row.label}>
                        <th>{row.label}</th>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={"correction-scenario-body" + (activeTab === "scenario" ? "" : " d-none")}>
              <div className="scenario-spec">
                <div className="spec-header">
                  <span className="spec-label">{t("spec_label_expected")}</span>
                </div>
                <div className="spec-body">
                  {spec?.trim() ? (
                    <span dangerouslySetInnerHTML={{ __html: renderGherkin(spec) }} />
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
          </>
        )}
      </div>
        )}
      </div>
    </div>
  );
}
