import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { groupColor, badgeClass, fuzzyMatch } from "../utils/format";
import type { Test, Group } from "../types";
import "../styles/groups.css";

interface GroupNameModal {
  mode: "create" | "rename";
  editId: string | null;
  name: string;
}

interface ManageModal {
  groupId: string;
  selection: Set<string>;
  search: string;
}

interface TestRenameModal {
  filename: string;
  alias: string;
}

export default function GroupsPage() {
  const { t, ready, lang } = useI18n();
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchTests, setSearchTests] = useState("");
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(() => new Set());

  const [pickerFilename, setPickerFilename] = useState<string | null>(null);
  const [groupNameModal, setGroupNameModal] = useState<GroupNameModal | null>(null);
  const [manageModal, setManageModal] = useState<ManageModal | null>(null);
  const [testRenameModal, setTestRenameModal] = useState<TestRenameModal | null>(null);
  const [deleteGroupModal, setDeleteGroupModal] = useState<{ group: Group } | null>(null);
  const [testDeleteModal, setTestDeleteModal] = useState<{ test: Test } | null>(null);

  const deleteGroupResolve = useRef<((confirmed: boolean) => void) | null>(null);
  const testDeleteResolve = useRef<((confirmed: boolean) => void) | null>(null);

  const refreshTests = async () => {
    const res = await apiFetch("/api/tests");
    setAllTests(await res.json());
  };
  const refreshGroups = async () => {
    const res = await apiFetch("/api/groups");
    setGroups(await res.json());
  };

  useEffect(() => {
    if (!ready) return;
    (async () => {
      await Promise.all([refreshTests(), refreshGroups()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const getTestGroups = (filename: string) => groups.filter((g) => g.tests.includes(filename));

  const filteredTests = allTests.filter((tst) => fuzzyMatch(tst.alias || tst.name, searchTests));

  // ── Group picker (instant apply) ──

  const toggleGroupForTest = async (groupId: string, checked: boolean) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g || !pickerFilename) return;
    const newTests = checked ? [...g.tests.filter((f) => f !== pickerFilename), pickerFilename] : g.tests.filter((f) => f !== pickerFilename);
    await apiFetch("/api/groups/" + groupId, { method: "PUT", body: JSON.stringify({ tests: newTests }) });
    await refreshGroups();
  };

  // ── Group name modal (create/rename) ──

  const openCreateModal = () => setGroupNameModal({ mode: "create", editId: null, name: "" });
  const openRenameModal = (groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    setGroupNameModal({ mode: "rename", editId: groupId, name: g.name });
  };
  const closeGroupNameModal = () => setGroupNameModal(null);
  const saveGroupNameModal = async () => {
    if (!groupNameModal) return;
    const name = groupNameModal.name.trim();
    if (!name) return;
    if (groupNameModal.mode === "create") {
      await apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ name }) });
    } else {
      await apiFetch("/api/groups/" + groupNameModal.editId, { method: "PUT", body: JSON.stringify({ name }) });
    }
    await refreshGroups();
    closeGroupNameModal();
  };

  // ── Manage tests modal (explicit save) ──

  const openManageModal = (groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    setManageModal({ groupId, selection: new Set(g.tests), search: "" });
  };
  const closeManageModal = () => setManageModal(null);
  const toggleManageSelection = (filename: string, checked: boolean) => {
    setManageModal((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selection);
      if (checked) next.add(filename);
      else next.delete(filename);
      return { ...prev, selection: next };
    });
  };
  const saveManageModal = async () => {
    if (!manageModal) return;
    await apiFetch("/api/groups/" + manageModal.groupId, { method: "PUT", body: JSON.stringify({ tests: [...manageModal.selection] }) });
    await refreshGroups();
    closeManageModal();
  };

  // ── Delete group (promise-based confirm) ──

  const openDeleteGroupModal = (groupId: string): Promise<boolean> => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return Promise.resolve(false);
    return new Promise((resolve) => {
      deleteGroupResolve.current = resolve;
      setDeleteGroupModal({ group: g });
    });
  };
  const closeDeleteGroupModal = (confirmed: boolean) => {
    setDeleteGroupModal(null);
    if (deleteGroupResolve.current) {
      deleteGroupResolve.current(confirmed);
      deleteGroupResolve.current = null;
    }
  };
  const deleteGroup = async (groupId: string) => {
    const confirmed = await openDeleteGroupModal(groupId);
    if (!confirmed) return;
    await apiFetch("/api/groups/" + groupId, { method: "DELETE" });
    await refreshGroups();
  };

  // ── Test rename modal ──

  const openTestRenameModal = (filename: string) => {
    const tst = allTests.find((x) => x.filename === filename);
    if (!tst) return;
    setTestRenameModal({ filename, alias: tst.alias || "" });
  };
  const closeTestRenameModal = () => setTestRenameModal(null);
  const saveTestRename = async () => {
    if (!testRenameModal) return;
    const alias = testRenameModal.alias.trim();
    const testkey = testRenameModal.filename.replace(".spec.ts", "");
    await apiFetch("/api/test-aliases/" + encodeURIComponent(testkey), { method: "PUT", body: JSON.stringify({ alias }) });
    await refreshTests();
    closeTestRenameModal();
  };

  // ── Test delete modal (promise-based confirm) ──

  const openTestDeleteModal = (filename: string): Promise<boolean> => {
    const tst = allTests.find((x) => x.filename === filename);
    if (!tst) return Promise.resolve(false);
    return new Promise((resolve) => {
      testDeleteResolve.current = resolve;
      setTestDeleteModal({ test: tst });
    });
  };
  const closeTestDeleteModal = (confirmed: boolean) => {
    setTestDeleteModal(null);
    if (testDeleteResolve.current) {
      testDeleteResolve.current(confirmed);
      testDeleteResolve.current = null;
    }
  };
  const deleteTest = async (filename: string) => {
    const confirmed = await openTestDeleteModal(filename);
    if (!confirmed) return;
    const testkey = filename.replace(".spec.ts", "");
    await apiFetch("/api/tests/" + encodeURIComponent(testkey), { method: "DELETE" });
    await Promise.all([refreshTests(), refreshGroups()]);
  };

  const toggleGroupOpen = (groupId: string) => {
    setOpenGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const removeTestFromGroup = async (groupId: string, filename: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    await apiFetch("/api/groups/" + groupId, { method: "PUT", body: JSON.stringify({ tests: g.tests.filter((f) => f !== filename) }) });
    await refreshGroups();
  };

  // ── Global Escape/Enter handling per open modal ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (pickerFilename && e.key === "Escape") setPickerFilename(null);
      if (manageModal && e.key === "Escape") closeManageModal();
      if (deleteGroupModal) {
        if (e.key === "Escape") closeDeleteGroupModal(false);
        if (e.key === "Enter") closeDeleteGroupModal(true);
      }
      if (testDeleteModal) {
        if (e.key === "Escape") closeTestDeleteModal(false);
        if (e.key === "Enter") closeTestDeleteModal(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerFilename, manageModal, deleteGroupModal, testDeleteModal]);

  const manageFilteredTests = manageModal ? allTests.filter((tst) => fuzzyMatch(tst.alias || tst.name, manageModal.search)) : [];

  return (
    <>
      <div className="app-topbar">
        <h1>{t("groups_page_title")}</h1>
        <span className="badge-env">GROUPES</span>
      </div>

      <div className="app-content">
        <div className="panels-layout">
          <div className="panel panel-available">
            <div className="panel-header">
              <div className="d-flex align-items-center justify-content-between">
                <h2 className="panel-title">{t("panel_tests_available_title")}</h2>
                <span className="avail-count">
                  {filteredTests.length !== allTests.length ? `${filteredTests.length}/${allTests.length}` : `${allTests.length}`}
                </span>
              </div>
              <div className="panel-search-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zm-5.242 1.156a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11" />
                </svg>
                <input
                  type="text"
                  className="panel-search-input"
                  placeholder={t("search_test_groups_placeholder")}
                  value={searchTests}
                  onChange={(e) => setSearchTests(e.target.value)}
                />
              </div>
            </div>
            <div className="panel-body">
              {filteredTests.map((tst) => {
                const testGroups = getTestGroups(tst.filename);
                const displayName = tst.alias || tst.name;
                let content: React.ReactNode, extraClass = "", btnStyle: React.CSSProperties = {};
                if (testGroups.length === 0) {
                  content = t("assign_btn_label");
                } else if (testGroups.length === 1) {
                  const col = groupColor(groups.findIndex((g) => g.id === testGroups[0].id));
                  content = testGroups[0].name;
                  btnStyle = { backgroundColor: col.bg, color: col.text, borderColor: col.border };
                  extraClass = " has-group";
                } else {
                  content = (
                    <>
                      {testGroups.map((g) => {
                        const col = groupColor(groups.findIndex((x) => x.id === g.id));
                        return (
                          <span
                            key={g.id}
                            style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: col.text, margin: "0 2px", flexShrink: 0 }}
                          />
                        );
                      })}
                      <span>{testGroups.length} groupes</span>
                    </>
                  );
                  extraClass = " has-group multi-group";
                }
                return (
                  <div className="avail-item" key={tst.filename}>
                    <div className="avail-item-info">
                      <p className="test-name">
                        {displayName}
                        {tst.alias && <span className="test-alias-hint" title={tst.filename}> ({tst.filename.replace(".spec.ts", "")})</span>}
                      </p>
                      <span className={`badge-type ${badgeClass(tst.type)}`}>{tst.typeLabel}</span>
                    </div>
                    <div className="avail-item-actions">
                      <button
                        className="btn-test-action btn-test-rename"
                        title={t("btn_test_rename_title")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openTestRenameModal(tst.filename);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12z" />
                          <path fillRule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z" />
                        </svg>
                      </button>
                      <button
                        className="btn-test-action btn-test-delete"
                        title={t("btn_test_delete_title")}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTest(tst.filename);
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                        </svg>
                      </button>
                    </div>
                    <button className={"group-assign-btn" + extraClass} style={btnStyle} onClick={() => setPickerFilename(tst.filename)}>
                      {content}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel panel-groups">
            <div className="panel-header panel-header-row">
              <div className="d-flex align-items-center gap-3">
                <h2 className="panel-title">{t("panel_groups_title")}</h2>
                <button className="btn btn-primary btn-sm btn-run-all" onClick={openCreateModal}>
                  {t("btn_new_group")}
                </button>
              </div>
              <span className="queue-count">{groups.length === 0 ? "0 groupe" : `${groups.length} groupe${groups.length > 1 ? "s" : ""}`}</span>
            </div>
            <div className="panel-body">
              {groups.length === 0 && (
                <div className="queue-empty">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16" style={{ opacity: 0.25 }}>
                    <path d="M.5 3l.04.87a1.99 1.99 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H9v-1H2.826a1 1 0 0 1-.995-.91l-.637-7A1 1 0 0 1 2.19 4h11.62a1 1 0 0 1 .996 1.09L14.54 8h1.005l.256-2.819A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2zm5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19c-.24 0-.47.042-.683.12L1.5 2.98a1 1 0 0 1 1-.98h3.672z" />
                    <path d="M13.5 9a.5.5 0 0 1 .5.5V11h1.5a.5.5 0 1 1 0 1H14v1.5a.5.5 0 1 1-1 0V12h-1.5a.5.5 0 0 1 0-1H13V9.5a.5.5 0 0 1 .5-.5z" />
                  </svg>
                  <p>{t("groups_empty_message")}</p>
                </div>
              )}
              {groups.map((g, idx) => {
                const col = groupColor(idx);
                const isOpen = openGroupIds.has(g.id);
                return (
                  <div className={"group-card" + (isOpen ? " is-open" : "")} key={g.id}>
                    <div className="group-card-header" style={{ borderLeft: `3px solid ${col.text}` }}>
                      <div className="group-card-header-toggle" onClick={() => toggleGroupOpen(g.id)}>
                        <span className="group-chevron">›</span>
                        <span className="group-color-dot" style={{ background: col.text }} />
                        <span className="group-card-name">{g.name}</span>
                        <span className="group-card-count" style={{ background: col.bg, color: col.text }}>
                          {g.tests.length}
                        </span>
                      </div>
                      <div className="group-card-actions">
                        <button className="btn-group-action btn-group-manage" title={t("btn_manage_tests_title")} onClick={() => openManageModal(g.id)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path
                              fillRule="evenodd"
                              d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M3.854 2.146a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708L2 3.293l1.146-1.147a.5.5 0 0 1 .708 0m0 4a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708L2 7.293l1.146-1.147a.5.5 0 0 1 .708 0m0 4a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 0 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0"
                            />
                          </svg>
                        </button>
                        <button className="btn-group-action btn-group-rename" title={t("btn_rename_title")} onClick={() => openRenameModal(g.id)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12z" />
                            <path fillRule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z" />
                          </svg>
                        </button>
                        <button className="btn-group-action btn-group-delete" title={t("btn_delete_title")} onClick={() => deleteGroup(g.id)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="group-card-body">
                      {g.tests.length === 0 ? (
                        <p className="group-card-empty-tests">{t("group_card_empty_tests")}</p>
                      ) : (
                        g.tests.map((fn) => {
                          const tst = allTests.find((x) => x.filename === fn);
                          const name = tst ? tst.alias || tst.name : fn;
                          return (
                            <div className="group-test-row" key={fn}>
                              <div className="avail-item-info">
                                <p className="test-name">{name}</p>
                                {tst && <span className={`badge-type ${badgeClass(tst.type)}`}>{tst.typeLabel}</span>}
                              </div>
                              <button
                                className="btn-remove-queue chip-remove"
                                title={t("btn_remove_from_group_title")}
                                onClick={() => removeTestFromGroup(g.id, fn)}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Test rename modal ── */}
      {testRenameModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeTestRenameModal()}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_rename_test_title")}</h2>
              <button className="results-close-btn" onClick={closeTestRenameModal}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("test_alias_label")}</label>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder={t("test_alias_placeholder")}
                value={testRenameModal.alias}
                onChange={(e) => setTestRenameModal({ ...testRenameModal, alias: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTestRename();
                  if (e.key === "Escape") closeTestRenameModal();
                }}
              />
              <p className="form-text mt-2" style={{ fontSize: "0.8rem", color: "#6c757d" }}>
                {t("test_alias_hint")}
              </p>
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeTestRenameModal}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveTestRename}>
                {t("btn_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Test delete modal ── */}
      {testDeleteModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeTestDeleteModal(false)}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_delete_test_title")}</h2>
              <button className="results-close-btn" onClick={() => closeTestDeleteModal(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <div className="delete-confirm-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
                </svg>
              </div>
              <p className="delete-confirm-message">
                {t("test_delete_confirm_prefix")} « {testDeleteModal.test.alias || testDeleteModal.test.name} » ?
              </p>
              <p style={{ fontSize: "0.82rem", color: "#6c757d", textAlign: "center", margin: 0 }}>{t("test_delete_warning")}</p>
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => closeTestDeleteModal(false)}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-danger btn-sm" autoFocus onClick={() => closeTestDeleteModal(true)}>
                {t("btn_delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Group picker modal ── */}
      {pickerFilename && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && setPickerFilename(null)}>
          <div className="results-dialog group-picker-dialog">
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_assign_groups_title")}</h2>
              <button className="results-close-btn" onClick={() => setPickerFilename(null)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body group-picker-body">
              {groups.length === 0 && (
                <p style={{ padding: "1rem 1.5rem", color: "#888", textAlign: "center", fontSize: "0.9rem" }}>{t("no_group_created")}</p>
              )}
              {groups.map((g, i) => {
                const col = groupColor(i);
                const checked = getTestGroups(pickerFilename).some((x) => x.id === g.id);
                return (
                  <label
                    className={"group-picker-item group-picker-checkbox-row" + (checked ? " is-selected" : "")}
                    style={checked ? { background: col.bg } : {}}
                    key={g.id}
                  >
                    <input type="checkbox" className="group-picker-cb" checked={checked} onChange={(e) => toggleGroupForTest(g.id, e.target.checked)} />
                    <span className="group-picker-dot" style={{ background: col.text, flexShrink: 0 }} />
                    <span className="group-picker-name" style={checked ? { color: col.text, fontWeight: 600 } : {}}>
                      {g.name}
                    </span>
                    <span className="group-picker-count">
                      {g.tests.length} test{g.tests.length !== 1 ? "s" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete group confirmation modal ── */}
      {deleteGroupModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeDeleteGroupModal(false)}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{t("modal_delete_group_title")}</h2>
              <button className="results-close-btn" onClick={() => closeDeleteGroupModal(false)}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <div className="delete-confirm-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
                </svg>
              </div>
              <p className="delete-confirm-message">
                {lang === "fr" ? "Supprimer le groupe" : "Delete group"} « {deleteGroupModal.group.name} » ?
              </p>
              {deleteGroupModal.group.tests.length > 0 && (
                <p className="delete-confirm-sub">
                  {deleteGroupModal.group.tests.length} test{deleteGroupModal.group.tests.length > 1 ? "s" : ""}{" "}
                  {lang === "fr"
                    ? "assigné" + (deleteGroupModal.group.tests.length > 1 ? "s" : "") + " seront désassignés."
                    : (deleteGroupModal.group.tests.length > 1 ? "assigned tests" : "assigned test") + " will be unassigned."}
                </p>
              )}
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => closeDeleteGroupModal(false)}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-danger btn-sm" autoFocus onClick={() => closeDeleteGroupModal(true)}>
                {t("btn_delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage tests modal ── */}
      {manageModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeManageModal()}>
          <div className="results-dialog manage-tests-dialog">
            <div className="results-dialog-header">
              <h2 className="results-title">
                {(() => {
                  const g = groups.find((x) => x.id === manageModal.groupId);
                  const idx = groups.findIndex((x) => x.id === manageModal.groupId);
                  const col = groupColor(idx);
                  return (
                    <>
                      {t("modal_manage_tests_title")} — <span style={{ color: col.text }}>{g?.name}</span>
                    </>
                  );
                })()}
              </h2>
              <button className="results-close-btn" onClick={closeManageModal}>
                ×
              </button>
            </div>
            <div className="manage-tests-search-wrap">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zm-5.242 1.156a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11" />
              </svg>
              <input
                type="text"
                className="panel-search-input"
                autoFocus
                placeholder={t("search_test_groups_placeholder")}
                value={manageModal.search}
                onChange={(e) => setManageModal({ ...manageModal, search: e.target.value })}
              />
            </div>
            <div className="results-dialog-body manage-tests-body">
              {manageFilteredTests.map((tst) => (
                <label className="manage-test-row" key={tst.filename}>
                  <input
                    type="checkbox"
                    className="manage-test-checkbox"
                    checked={manageModal.selection.has(tst.filename)}
                    onChange={(e) => toggleManageSelection(tst.filename, e.target.checked)}
                  />
                  <div className="avail-item-info" style={{ flex: 1, minWidth: 0 }}>
                    <p className="test-name" style={{ fontSize: "0.95rem" }}>
                      {tst.alias || tst.name}
                    </p>
                    <span className={`badge-type ${badgeClass(tst.type)}`}>{tst.typeLabel}</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="results-dialog-footer manage-tests-footer">
              <span className="manage-tests-selected">
                {manageModal.selection.size === 0
                  ? t("no_tests_selected")
                  : `${manageModal.selection.size} ${manageModal.selection.size > 1 ? t("n_tests_selected_plural") : t("n_tests_selected_singular")}`}
              </span>
              <div className="d-flex gap-2">
                <button className="btn btn-outline-secondary btn-sm" onClick={closeManageModal}>
                  {t("btn_cancel")}
                </button>
                <button className="btn btn-primary btn-sm" onClick={saveManageModal}>
                  {t("btn_save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Group name modal (create/rename) ── */}
      {groupNameModal && (
        <div className="results-overlay" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeGroupNameModal()}>
          <div className="results-dialog" style={{ maxWidth: 420 }}>
            <div className="results-dialog-header">
              <h2 className="results-title">{groupNameModal.mode === "create" ? t("modal_new_group_title") : t("modal_rename_group_title")}</h2>
              <button className="results-close-btn" onClick={closeGroupNameModal}>
                ×
              </button>
            </div>
            <div className="results-dialog-body" style={{ padding: "1.25rem 1.5rem" }}>
              <label className="form-label small fw-semibold">{t("group_name_label")}</label>
              <input
                type="text"
                className="form-control"
                autoFocus
                placeholder={t("group_name_placeholder")}
                value={groupNameModal.name}
                onChange={(e) => setGroupNameModal({ ...groupNameModal, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveGroupNameModal();
                  if (e.key === "Escape") closeGroupNameModal();
                }}
              />
            </div>
            <div className="results-dialog-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={closeGroupNameModal}>
                {t("btn_cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveGroupNameModal}>
                {t("btn_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
