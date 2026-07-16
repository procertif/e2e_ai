import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import "../styles/groups.css";
import "../styles/versioning.css";

interface Conflict {
  files: string[];
}

interface RepoStatus {
  configured: boolean;
  branch?: string;
  hasRemoteBranch?: boolean;
  conflict?: Conflict | null;
  changedCount?: number;
  hasStaleFiles?: boolean;
}

interface DiffFile {
  status: string;
  file: string;
  category: string;
  name: string | null;
}

const STATUS_LABELS: Record<string, string> = { A: "status_added", M: "status_modified", D: "status_deleted", stale: "status_stale" };
const CATEGORY_ORDER = ["campaigns", "groups", "scenarios", "tests", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  campaigns: "versioning_category_campaigns",
  groups: "versioning_category_groups",
  scenarios: "versioning_category_scenarios",
  tests: "versioning_category_tests",
  other: "versioning_category_other",
};

function groupByCategory(files: DiffFile[]) {
  const groups = new Map<string, DiffFile[]>();
  for (const f of files) {
    const key = CATEGORY_ORDER.includes(f.category) ? f.category : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return CATEGORY_ORDER.map((category) => ({ category, items: groups.get(category) || [] })).filter((g) => g.items.length > 0);
}

function FetchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
      <path fillRule="evenodd" d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8.5 4.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5a.5.5 0 0 1 1 0" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
      <path fillRule="evenodd" d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8m15 0A8 8 0 1 0 0 8a8 8 0 0 0 16 0M8.5 11.5V5.707l2.146 2.147a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 1 0 .708.708L7.5 5.707V11.5a.5.5 0 0 0 1 0" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="8" rx="1" />
      <line x1="5.5" y1="13.5" x2="10.5" y2="13.5" strokeLinecap="round" />
      <line x1="8" y1="10.5" x2="8" y2="13.5" strokeLinecap="round" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
      <path d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.688 1.166-3.115 2.752-3.505.126-.995.836-1.844 1.654-2.471" />
    </svg>
  );
}

function DiffLine({ line }: { line: string }) {
  let cls = "versioning-diff-line";
  if (line.startsWith("+++") || line.startsWith("---")) cls += " versioning-diff-line--file";
  else if (line.startsWith("@@")) cls += " versioning-diff-line--hunk";
  else if (line.startsWith("+")) cls += " versioning-diff-line--add";
  else if (line.startsWith("-")) cls += " versioning-diff-line--del";
  return <div className={cls}>{line || " "}</div>;
}

export default function VersioningPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, diffRes] = await Promise.all([
        apiFetch("/api/versioned-repo/status"),
        apiFetch("/api/versioned-repo/diff"),
      ]);
      if (!statusRes.ok) throw new Error(await statusRes.text());
      setStatus(await statusRes.json());
      if (diffRes.ok) setFiles((await diffRes.json()).files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggleFile = async (file: string) => {
    if (openFile === file) {
      setOpenFile(null);
      return;
    }
    setOpenFile(file);
    if (fileDiffs[file] !== undefined) return;
    try {
      const res = await apiFetch("/api/versioned-repo/diff/file?path=" + encodeURIComponent(file));
      const text = res.ok ? await res.text() : t("versioning_diff_error");
      setFileDiffs((prev) => ({ ...prev, [file]: text }));
    } catch {
      setFileDiffs((prev) => ({ ...prev, [file]: t("versioning_diff_error") }));
    }
  };

  const doSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/versioned-repo/sync", { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const doPush = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/versioned-repo/push", { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const resolveConflict = async (resolution: "local" | "remote") => {
    setResolving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/versioned-repo/resolve-conflict", { method: "POST", body: JSON.stringify({ resolution }) });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  const conflict = status?.conflict || null;

  return (
    <>
      <div className="app-topbar">
        <h1>{t("versioning_page_title")}</h1>
        <span className="badge-env">SYNC</span>
      </div>

      <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
        {status === null ? (
          <div className="versioning-loading">
            <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("versioning_loading")}
          </div>
        ) : !status.configured ? (
          <div className="environments-empty">{t("versioning_not_configured")}</div>
        ) : (
          <>
            <div className="versioning-status-bar">
              <span className="text-muted small">
                {status.changedCount ?? 0} {(status.changedCount ?? 0) > 1 ? t("versioning_files_changed_plural") : t("versioning_files_changed_singular")}
              </span>
              <div className="versioning-status-actions">
                {loading && <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />}
                <button className="btn btn-outline-secondary btn-sm" disabled={loading} onClick={doSync}>
                  <FetchIcon /> {t("btn_sync_versioning")}
                </button>
                <button className="btn btn-primary btn-sm" disabled={loading || Boolean(conflict)} onClick={doPush}>
                  <PushIcon /> {t("btn_push_versioning")}
                </button>
              </div>
            </div>

            {error && <p className="versioning-error">{error}</p>}

            {!conflict && status.hasStaleFiles && (
              <div className="versioning-stale-banner">{t("versioning_stale_warning")}</div>
            )}

            {conflict && (
              <div className="versioning-conflict-banner">
                <p>{t("versioning_conflict_message").replace("{n}", String(conflict.files.length))}</p>
                <ul className="versioning-conflict-files">
                  {conflict.files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="versioning-conflict-actions">
                  <button className="btn btn-outline-secondary btn-sm" disabled={resolving} onClick={() => resolveConflict("local")}>
                    <LocalIcon /> {t("btn_keep_local")}
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" disabled={resolving} onClick={() => resolveConflict("remote")}>
                    <RemoteIcon /> {t("btn_keep_remote")}
                  </button>
                </div>
              </div>
            )}

            {loading && files === null ? (
              <div className="versioning-loading">
                <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("versioning_loading")}
              </div>
            ) : (
              <>
                {files?.length === 0 && <p className="environment-variables-empty">{t("versioning_no_changes")}</p>}
                {groupByCategory(files || []).map((group) => (
                  <div className="versioning-group" key={group.category}>
                    <h3 className="versioning-group-title">{t(CATEGORY_LABELS[group.category])}</h3>
                    <div className="versioning-file-list">
                      {group.items.map((f) => (
                        <div className="versioning-file-row" key={f.file}>
                          <button className="versioning-file-header" onClick={() => toggleFile(f.file)}>
                            <span className={`versioning-file-status versioning-file-status--${f.status}`}>{t(STATUS_LABELS[f.status] || "status_modified")}</span>
                            <span className="versioning-file-name">{f.name || f.file}</span>
                            <span className="versioning-file-chevron">{openFile === f.file ? "▾" : "▸"}</span>
                          </button>
                          {openFile === f.file && (
                            <pre className="versioning-diff">
                              {(fileDiffs[f.file] || t("loading")).split("\n").map((line, i) => (
                                <DiffLine line={line} key={i} />
                              ))}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
