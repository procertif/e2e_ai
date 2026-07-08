import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { ENVIRONMENT_COLORS, environmentColorHex } from "../utils/environmentColors";
import type { Environment } from "../types";
import "../styles/groups.css";
import "../styles/environments.css";

interface EnvironmentModal {
  mode: "create" | "edit";
  editId: number | null;
  name: string;
  url: string;
  comment: string;
  color: string;
}

interface DeleteModal {
  environment: Environment;
}

export default function EnvironmentsPage() {
  const { t, ready } = useI18n();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentModal, setEnvironmentModal] = useState<EnvironmentModal | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModal | null>(null);

  const refreshEnvironments = async () => {
    const res = await apiFetch("/api/environments");
    setEnvironments(await res.json());
  };

  useEffect(() => {
    if (!ready) return;
    refreshEnvironments();
  }, [ready]);

  const openCreateModal = () => setEnvironmentModal({ mode: "create", editId: null, name: "", url: "", comment: "", color: ENVIRONMENT_COLORS[0].key });
  const openEditModal = (environment: Environment) =>
    setEnvironmentModal({ mode: "edit", editId: environment.id, name: environment.name, url: environment.url, comment: environment.comment || "", color: environment.color });
  const closeEnvironmentModal = () => setEnvironmentModal(null);

  const saveEnvironmentModal = async () => {
    if (!environmentModal) return;
    const name = environmentModal.name.trim();
    const url = environmentModal.url.trim();
    if (!name || !url) return;
    const body = JSON.stringify({ name, url, comment: environmentModal.comment.trim(), color: environmentModal.color });
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
                {environment.comment && <p className="environment-card-comment">{environment.comment}</p>}
              </div>
              <div className="environment-card-actions">
                <button className="btn-environment-action btn-environment-rename" title={t("btn_edit_title")} onClick={() => openEditModal(environment)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12z" />
                    <path fillRule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z" />
                  </svg>
                </button>
                <button className="btn-environment-action btn-environment-delete" title={t("btn_delete_title")} onClick={() => openDeleteModal(environment)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {environmentModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeEnvironmentModal()}>
          <div className="results-dialog" style={{ maxWidth: 480 }}>
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
              <label className="form-label small fw-semibold">{t("environment_comment_label")}</label>
              <textarea
                className="form-control mb-3"
                rows={3}
                placeholder={t("environment_comment_placeholder")}
                value={environmentModal.comment}
                onChange={(e) => setEnvironmentModal({ ...environmentModal, comment: e.target.value })}
              />
              <label className="form-label small fw-semibold">{t("environment_color_label")}</label>
              <div className="environment-color-swatches">
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
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeEnvironmentModal}>
                {t("btn_cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!environmentModal.name.trim() || !environmentModal.url.trim()}
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
