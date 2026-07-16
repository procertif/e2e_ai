import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faList, faPlus } from "@fortawesome/free-solid-svg-icons";
import { faCopy } from "@fortawesome/free-regular-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useAiQueue } from "../ai/AiQueueContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import { escHtml, fuzzyMatch } from "../utils/format";
import ScenarioChatPanel from "../scenarios/ScenarioChatPanel";
import type { Test } from "../types";
import "../styles/groups.css";
import "../styles/chat.css";
import "../styles/campaigns.css";
import "../styles/corrections.css";
import "../styles/scenarios.css";

const GHERKIN_KEYWORDS = ["Étant donné", "Étant donnés", "Étant données", "Quand", "Lorsque", "Alors", "Et", "Mais"];

interface ScenarioListItem {
  testname: string;
  title: string | null;
  hasTest: boolean;
  hasSpec: boolean;
  updatedAt: number | null;
}

// Mirror of the backend slug so the modal can preview the filename live.
function slugify(title: string) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface SpecState {
  state: "idle" | "loading" | "ready" | "unavailable";
  text: string;
}

function renderGherkin(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const kw = GHERKIN_KEYWORDS.find((k) => line.trimStart().startsWith(k));
      const safe = escHtml(line);
      if (!kw) return safe;
      const safeKw = escHtml(kw);
      return safe.replace(safeKw, `<span class="spec-keyword">${safeKw}</span>`);
    })
    .join("\n");
}

function CopyButton({ text, title, showLabel, labelText }: { text: string; title: string; showLabel?: boolean; labelText?: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className="copy-btn" title={title} onClick={doCopy}>
      {copied ? (
        "✓"
      ) : (
        <>
          <FontAwesomeIcon icon={faCopy} style={{ fontSize: 12 }} />
          {showLabel && <span>{labelText}</span>}
        </>
      )}
    </button>
  );
}

export default function ScenariosPage() {
  const { t, ready } = useI18n();
  const { tasks: aiQueueTasks } = useAiQueue();
  const { environments, selectedId, setSelectedId } = useEnvironment();
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([]);
  const [dotCount, setDotCount] = useState(1);
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecState>({ state: "idle", text: "" });
  const [createModal, setCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const refreshList = async () => {
    const [scenariosRes, testsRes] = await Promise.all([apiFetch("/api/scenarios"), apiFetch("/api/tests")]);
    setScenarios(await scenariosRes.json());
    const tests: Test[] = await testsRes.json();
    setAliases(new Map(tests.filter((tst) => tst.alias).map((tst) => [tst.filename.replace(/\.spec\.ts$/, ""), tst.alias!])));
  };

  useEffect(() => {
    if (!ready) return;
    refreshList();
  }, [ready]);

  // Same badge machinery as the Corrections list: the global AI queue is the
  // source of truth, one task per scenario keyed by testname.
  const scenarioTasks = aiQueueTasks.filter((task) => task.kind === "scenario");

  useEffect(() => {
    if (scenarioTasks.length === 0) {
      setDotCount(1);
      return;
    }
    const interval = setInterval(() => setDotCount((d) => (d % 3) + 1), 450);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioTasks.length]);

  const titles = new Map(scenarios.filter((s) => s.title).map((s) => [s.testname, s.title!]));
  const displayName = (testname: string) => titles.get(testname) || aliases.get(testname) || testname;
  const filtered = scenarios.filter((s) => fuzzyMatch(displayName(s.testname), query));

  const loadSpec = async (testname: string) => {
    setSpec({ state: "loading", text: "" });
    try {
      const res = await apiFetch(`/api/spec/${encodeURIComponent(testname)}`);
      if (!res.ok) throw new Error();
      const { spec: specText } = await res.json();
      setSpec({ state: "ready", text: specText });
    } catch {
      setSpec({ state: "unavailable", text: "" });
    }
  };

  const selectScenario = (testname: string) => {
    setSelected(testname);
    loadSpec(testname);
  };

  const createScenario = async () => {
    const title = newTitle.trim();
    if (!title || !slugify(title)) return;
    setCreateError(null);
    try {
      const res = await apiFetch("/api/scenarios", { method: "POST", body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      setCreateModal(false);
      setNewTitle("");
      await refreshList();
      selectScenario(created.testname);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app-content">
      <div className="panels-layout scenarios-layout">
        <div className="panel panel-available scenarios-list-panel">
          <div className="panel-header">
            <div className="d-flex align-items-center justify-content-between">
              <h2 className="panel-title">{t("nav_scenarios")}</h2>
              <button className="btn btn-primary btn-sm scenario-add-btn" onClick={() => { setCreateModal(true); setNewTitle(""); setCreateError(null); }}>
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> {t("btn_add_scenario")}
              </button>
            </div>
            <div className="panel-search-wrap">
              <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: 13 }} />
              <input
                type="text"
                className="panel-search-input"
                placeholder={t("search_scenarios_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="panel-body">
            <div id="test-list">
              {filtered.map((s) => {
                const task = scenarioTasks.find((tk) => tk.targetKey === s.testname);
                const isCurrent = task?.status === "running";
                const isQueued = task?.status === "queued";
                const taskEnvName = task ? environments.find((e) => e.id === task.environmentId)?.name || null : null;
                return (
                  <div
                    key={s.testname}
                    className={"test-item scenario-test-item" + (selected === s.testname ? " selected" : "")}
                    onClick={() => selectScenario(s.testname)}
                  >
                    <span className="test-name">{displayName(s.testname)}</span>
                    {(isCurrent || isQueued) && (
                      <div className={"campaign-progress" + (isQueued ? " is-queued" : "")}>
                        <span className="spinner-border spinner-xs" role="status" />
                        <span className="campaign-progress-text">{isCurrent ? t("scenario_running_label") : t("scenario_queued_label")}</span>
                        <span className="campaign-progress-dots">{".".repeat(dotCount)}</span>
                        {taskEnvName && <span className="correction-task-env">· {taskEnvName}</span>}
                      </div>
                    )}
                    <span className={"scenario-link-badge" + (s.hasTest ? " scenario-link-badge--linked" : " scenario-link-badge--unlinked")}>
                      {s.hasTest ? t("scenario_badge_linked") : t("scenario_badge_unlinked")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel panel-scenarios scenarios-spec-panel">
          {!selected && (
            <div className="scenario-empty">
              <FontAwesomeIcon icon={faList} style={{ fontSize: 36, opacity: 0.2 }} />
              <p>{t("scenario_empty_message")}</p>
            </div>
          )}

          {selected && (
            <div style={{ height: "100%", overflowY: "auto", padding: "1.25rem 1.5rem" }}>
              <div className="scenario-header">
                <div>
                  <h2 className="scenario-title">{displayName(selected)}</h2>
                </div>
              </div>

              <div className="scenario-spec">
                <div className="spec-header">
                  <span className="spec-label">{t("spec_label_expected")}</span>
                  <CopyButton text={spec.text} title={t("btn_copy")} showLabel labelText={t("btn_copy")} />
                </div>
                <div className="spec-body">
                  {spec.state === "ready" && spec.text.trim() ? (
                    <span dangerouslySetInnerHTML={{ __html: renderGherkin(spec.text) }} />
                  ) : spec.state === "loading" ? (
                    <span className="spec-generating">{t("spec_generating")}</span>
                  ) : (
                    <span className="spec-generating">{t("spec_unavailable")}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="panel scenarios-chat-panel">
          {!selected ? (
            <div className="scenario-empty">
              <p>{t("scenario_chat_select_hint")}</p>
            </div>
          ) : (
            <>
              <div className="panel-header scenarios-chat-header">
                <h2 className="panel-title">{t("scenario_chat_title")}</h2>
                <select
                  className="form-select form-select-sm scenario-env-select"
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value === "" ? null : Number(e.target.value))}
                >
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </div>
              <ScenarioChatPanel testname={selected} environmentId={selectedId} onUpdate={() => loadSpec(selected)} />
            </>
          )}
        </div>
      </div>

      {createModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && setCreateModal(false)}>
          <div className="results-dialog" style={{ maxWidth: 460 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_new_scenario_title")}</h2>
              <button className="results-close-btn" onClick={() => setCreateModal(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("scenario_title_label")}</label>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder={t("scenario_title_placeholder")}
                value={newTitle}
                maxLength={120}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createScenario();
                  if (e.key === "Escape") setCreateModal(false);
                }}
              />
              {newTitle.trim() && (
                <p className="scenario-slug-preview">
                  {t("scenario_slug_preview")} <code>{slugify(newTitle) || "—"}</code>
                </p>
              )}
              {createError && <p className="versioning-error" style={{ marginTop: "0.5rem" }}>{createError}</p>}
              <div className="d-flex justify-content-end gap-2" style={{ marginTop: "1rem" }}>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setCreateModal(false)}>
                  {t("btn_cancel")}
                </button>
                <button className="btn btn-primary btn-sm" disabled={!slugify(newTitle)} onClick={createScenario}>
                  {t("btn_create_scenario")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
