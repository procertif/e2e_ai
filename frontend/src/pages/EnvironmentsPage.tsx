import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faArrowsRotate, faPenToSquare, faTrash } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { ENVIRONMENT_COLORS, environmentColorHex } from "../utils/environmentColors";
import type { Environment, EnvironmentVariable } from "../types";
import "../styles/groups.css";
import "../styles/environments.css";

const VARIABLE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function WarningIcon() {
  return <FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: 13 }} />;
}

function RefreshIcon() {
  return <FontAwesomeIcon icon={faArrowsRotate} style={{ fontSize: 14 }} />;
}

interface EnvironmentModal {
  mode: "create" | "edit";
  editId: number | null;
  name: string;
  url: string;
  variables: EnvironmentVariable[];
  color: string;
  branch: string;
}

interface DeleteModal {
  environment: Environment;
}

interface RepoFetchState {
  status: "running" | "done" | "error";
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export default function EnvironmentsPage() {
  const { t, ready } = useI18n();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentModal, setEnvironmentModal] = useState<EnvironmentModal | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModal | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  // Fetch progress/errors live on the backend, keyed by branch — polling them
  // (instead of holding a local "fetching" flag) is what lets this page be
  // left and reopened mid-clone and still show the true state.
  const [fetchStates, setFetchStates] = useState<Record<string, RepoFetchState>>({});
  const fetchStatesRef = useRef<Record<string, RepoFetchState>>({});

  const refreshEnvironments = async () => {
    const res = await apiFetch("/api/environments");
    setEnvironments(await res.json());
  };

  const pollFetchStatus = async () => {
    try {
      const res = await apiFetch("/api/repo/fetch-status");
      if (!res.ok) return;
      const next: Record<string, RepoFetchState> = await res.json();
      const prev = fetchStatesRef.current;
      const justFinished = Object.keys(next).some((b) => prev[b]?.status === "running" && next[b].status !== "running");
      fetchStatesRef.current = next;
      setFetchStates(next);
      // A fetch that finished (possibly started from another tab, or before a
      // reload) changes lastFetchedCommit/hasUpdate — refresh the cards.
      if (justFinished) refreshEnvironments();
    } catch {}
  };

  useEffect(() => {
    if (!ready) return;
    refreshEnvironments();
    pollFetchStatus();
    const interval = setInterval(pollFetchStatus, 1500);
    (async () => {
      try {
        const res = await apiFetch("/api/repo/branches");
        if (res.ok) { setBranches(await res.json()); return; }
        setBranchesError(await res.text());
      } catch (err) {
        setBranchesError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const handleFetch = async (environment: Environment) => {
    const branch = environment.branch;
    if (!branch) return;
    // Optimistic: the next poll (≤1.5s away) takes over with the server state.
    const optimistic: RepoFetchState = { status: "running", error: null, startedAt: Date.now(), endedAt: null };
    fetchStatesRef.current = { ...fetchStatesRef.current, [branch]: optimistic };
    setFetchStates((prev) => ({ ...prev, [branch]: optimistic }));
    try {
      const res = await apiFetch("/api/environments/" + environment.id + "/fetch", { method: "POST" });
      if (res.ok) await refreshEnvironments();
    } catch {}
    // Whether it succeeded, failed, or 409'd (already running), the backend
    // state is the truth — sync immediately instead of waiting for the tick.
    await pollFetchStatus();
  };

  const openCreateModal = () => setEnvironmentModal({ mode: "create", editId: null, name: "", url: "", variables: [], color: ENVIRONMENT_COLORS[0].key, branch: "" });
  const openEditModal = (environment: Environment) =>
    setEnvironmentModal({
      mode: "edit",
      editId: environment.id,
      name: environment.name,
      url: environment.url,
      variables: environment.variables.map((v) => ({ ...v })),
      color: environment.color,
      branch: environment.branch || "",
    });
  const closeEnvironmentModal = () => setEnvironmentModal(null);

  const addVariableRow = () => {
    if (!environmentModal) return;
    setEnvironmentModal({ ...environmentModal, variables: [...environmentModal.variables, { key: "", value: "", description: "" }] });
  };
  const updateVariableRow = (index: number, patch: Partial<EnvironmentVariable>) => {
    if (!environmentModal) return;
    const variables = environmentModal.variables.map((v, i) => (i === index ? { ...v, ...patch } : v));
    setEnvironmentModal({ ...environmentModal, variables });
  };
  const removeVariableRow = (index: number) => {
    if (!environmentModal) return;
    setEnvironmentModal({ ...environmentModal, variables: environmentModal.variables.filter((_, i) => i !== index) });
  };

  const nonEmptyVariables = environmentModal ? environmentModal.variables.filter((v) => v.key.trim() || v.value.trim()) : [];
  const variablesValid = nonEmptyVariables.every((v) => VARIABLE_KEY_RE.test(v.key.trim()))
    && new Set(nonEmptyVariables.map((v) => v.key.trim())).size === nonEmptyVariables.length;

  const saveEnvironmentModal = async () => {
    if (!environmentModal || !variablesValid) return;
    const name = environmentModal.name.trim();
    const url = environmentModal.url.trim();
    if (!name || !url) return;
    const variables = nonEmptyVariables.map((v) => ({ key: v.key.trim(), value: v.value, description: (v.description || "").trim() || null }));
    const body = JSON.stringify({ name, url, variables, color: environmentModal.color, branch: environmentModal.branch || null });
    if (environmentModal.mode === "create") {
      await apiFetch("/api/environments", { method: "POST", body });
    } else {
      await apiFetch("/api/environments/" + environmentModal.editId, { method: "PUT", body });
    }
    await refreshEnvironments();
    closeEnvironmentModal();
  };

  const openDeleteModal = (environment: Environment) => setDeleteModal({ environment });
  const closeDeleteModal = () => setDeleteModal(null);
  const confirmDelete = async () => {
    if (!deleteModal) return;
    await apiFetch("/api/environments/" + deleteModal.environment.id, { method: "DELETE" });
    await refreshEnvironments();
    closeDeleteModal();
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("environments_page_title")}</h1>
        <span className="badge-env">ENVIRONMENTS</span>
      </div>

      <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <span className="text-muted small">
            {environments.length} {environments.length !== 1 ? t("environments_count_plural") : t("environments_count_singular")}
          </span>
          <button className="btn btn-primary btn-sm" onClick={openCreateModal}>
            {t("btn_new_environment")}
          </button>
        </div>

        <div className="environments-list">
          {environments.length === 0 && <div className="environments-empty">{t("environments_empty_message")}</div>}
          {environments.map((environment) => (
            <div className="environment-card" key={environment.id}>
              <span className="environment-color-dot" style={{ background: environmentColorHex(environment.color) }} />
              <div className="environment-card-info">
                <p className="environment-card-name">{environment.name}</p>
                <a className="environment-card-url" href={environment.url} target="_blank" rel="noreferrer">
                  {environment.url}
                </a>
                {environment.variables.length > 0 && (
                  <div className="environment-card-variables">
                    {environment.variables.map((v) => (
                      <span className="environment-card-variable" key={v.key} title={v.description || undefined}>
                        {v.key}
                      </span>
                    ))}
                  </div>
                )}
                {environment.branch && (() => {
                  const fetchState = fetchStates[environment.branch] || null;
                  const isFetching = fetchState?.status === "running";
                  return (
                    <div className="environment-card-repo">
                      <span className="environment-card-branch">🌿 {environment.branch}</span>
                      {environment.lastFetchedCommit && (
                        <span className="environment-card-commit" title={environment.lastFetchedCommit}>
                          {environment.lastFetchedCommit.slice(0, 7)}
                        </span>
                      )}
                      {environment.hasUpdate && (
                        <span className="environment-update-warning" title={t("environment_update_available")}>
                          <WarningIcon />
                        </span>
                      )}
                      <button
                        className="btn-environment-action environment-fetch-icon-btn"
                        title={t("btn_fetch_repo")}
                        disabled={isFetching}
                        onClick={() => handleFetch(environment)}
                      >
                        {isFetching ? (
                          <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />
                        ) : (
                          <RefreshIcon />
                        )}
                      </button>
                      {isFetching && <span className="environment-fetch-progress">{t("environment_fetch_in_progress")}</span>}
                      {fetchState?.status === "error" && fetchState.error && (
                        <span className="environment-fetch-error">{fetchState.error}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="environment-card-actions">
                <button className="btn-environment-action btn-environment-rename" title={t("btn_edit_title")} onClick={() => openEditModal(environment)}>
                  <FontAwesomeIcon icon={faPenToSquare} style={{ fontSize: 14 }} />
                </button>
                <button className="btn-environment-action btn-environment-delete" title={t("btn_delete_title")} onClick={() => openDeleteModal(environment)}>
                  <FontAwesomeIcon icon={faTrash} style={{ fontSize: 14 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {environmentModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeEnvironmentModal()}>
          <div className="results-dialog" style={{ maxWidth: 760, maxHeight: "88vh" }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{environmentModal.mode === "create" ? t("modal_new_environment_title") : t("modal_edit_environment_title")}</h2>
              <button className="results-close-btn" onClick={closeEnvironmentModal}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("environment_name_label")}</label>
              <input
                type="text"
                className="form-control mb-3"
                autoFocus
                placeholder={t("environment_name_placeholder")}
                value={environmentModal.name}
                onChange={(e) => setEnvironmentModal({ ...environmentModal, name: e.target.value })}
              />
              <label className="form-label small fw-semibold">{t("environment_url_label")}</label>
              <input
                type="text"
                className="form-control mb-3"
                placeholder={t("environment_url_placeholder")}
                value={environmentModal.url}
                onChange={(e) => setEnvironmentModal({ ...environmentModal, url: e.target.value })}
              />
              <label className="form-label small fw-semibold">{t("environment_color_label")}</label>
              <div className="environment-color-swatches mb-3">
                {ENVIRONMENT_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={"environment-color-swatch" + (environmentModal.color === c.key ? " is-selected" : "")}
                    style={{ background: c.hex }}
                    title={c.key}
                    onClick={() => setEnvironmentModal({ ...environmentModal, color: c.key })}
                  />
                ))}
              </div>
              <label className="form-label small fw-semibold">{t("environment_branch_label")}</label>
              {branchesError && !branches && <p className="environment-variables-hint text-muted small">{t("environment_branch_unavailable")}</p>}
              <select
                className="form-select form-select-sm mb-3"
                value={environmentModal.branch}
                disabled={!branches}
                onChange={(e) => setEnvironmentModal({ ...environmentModal, branch: e.target.value })}
              >
                <option value="">{t("environment_branch_none_option")}</option>
                {(branches || []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <label className="form-label small fw-semibold">{t("environment_variables_label")}</label>
              <p className="environment-variables-hint text-muted small">{t("environment_variables_hint")}</p>
              <div className="environment-variables-editor mb-2">
                {environmentModal.variables.length > 0 && (
                  <div className="environment-variable-row environment-variable-row-header">
                    <span>{t("environment_variable_key_label")}</span>
                    <span>{t("environment_variable_value_label")}</span>
                    <span>{t("environment_variable_description_label")}</span>
                    <span />
                  </div>
                )}
                {environmentModal.variables.length === 0 && (
                  <p className="environment-variables-empty">{t("environment_variables_empty")}</p>
                )}
                {environmentModal.variables.map((variable, i) => {
                  const trimmedKey = variable.key.trim();
                  const keyInvalid = trimmedKey !== "" && !VARIABLE_KEY_RE.test(trimmedKey);
                  const keyDuplicate = trimmedKey !== "" && environmentModal.variables.some((v, j) => j !== i && v.key.trim() === trimmedKey);
                  return (
                    <div className="environment-variable-row" key={i}>
                      <input
                        type="text"
                        className={"form-control environment-variable-key" + (keyInvalid || keyDuplicate ? " is-invalid" : "")}
                        placeholder={t("environment_variable_key_placeholder")}
                        title={keyInvalid ? t("environment_variable_key_invalid") : keyDuplicate ? t("environment_variable_key_duplicate") : undefined}
                        value={variable.key}
                        onChange={(e) => updateVariableRow(i, { key: e.target.value })}
                      />
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t("environment_variable_value_placeholder")}
                        value={variable.value}
                        onChange={(e) => updateVariableRow(i, { value: e.target.value })}
                      />
                      <input
                        type="text"
                        className="form-control"
                        placeholder={t("environment_variable_description_placeholder")}
                        value={variable.description || ""}
                        onChange={(e) => updateVariableRow(i, { description: e.target.value })}
                      />
                      <button type="button" className="btn-remove-variable" title={t("btn_delete_title")} onClick={() => removeVariableRow(i)}>
                        <FontAwesomeIcon icon={faTrash} style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={addVariableRow}>
                {t("btn_add_variable")}
              </button>
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeEnvironmentModal}>
                {t("btn_cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!environmentModal.name.trim() || !environmentModal.url.trim() || !variablesValid}
                onClick={saveEnvironmentModal}
              >
                {t("btn_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeDeleteModal()}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_delete_environment_title")}</h2>
              <button className="results-close-btn" onClick={closeDeleteModal}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <p className="delete-confirm-message">
                {t("environment_delete_confirm_prefix")} « {deleteModal.environment.name} » ?
              </p>
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeDeleteModal}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-danger btn-sm" autoFocus onClick={confirmDelete}>
                {t("btn_delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
