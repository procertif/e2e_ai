import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import "../styles/logs.css";

interface Totals {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  apiCalls?: number;
  toolsCalled?: number;
}

interface ApiCall {
  index: number;
  startedAt: string;
  durationMs: number;
  usage?: Totals;
  toolsCalled?: { name: string }[];
}

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "image"; media_type?: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "tool_result"; content: MessageContent };

type MessageContent = string | ContentBlock[];

interface LogMessage {
  role: "user" | "assistant";
  content: MessageContent;
}

interface LogDetail {
  totals?: Totals;
  apiCalls?: ApiCall[];
  messages?: LogMessage[];
  durationMs?: number;
}

interface Session {
  id: number;
  startedAt: string;
  totals?: Totals;
}

interface Detail {
  loading?: boolean;
  error?: boolean;
  log?: LogDetail;
}

function fmtDate(iso: string | undefined, lang: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return (
    d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
}

function fmtDuration(ms: number | undefined) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return ms + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + " s";
  return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
}

function fmtNum(n: number | undefined | null, lang: string) {
  if (n == null) return "—";
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return n.toLocaleString(locale);
}

function MessageContent({ content }: { content: MessageContent }) {
  const { t } = useI18n();
  if (typeof content === "string") {
    return <div className="msg-content-text">{content}</div>;
  }
  if (!Array.isArray(content)) return null;
  return (
    <>
      {content.map((block, i) => {
        if (block.type === "text") {
          return (
            <div className="msg-content-text" key={i}>
              {block.text || ""}
            </div>
          );
        }
        if (block.type === "image") {
          return (
            <div className="msg-image-placeholder" key={i}>
              [Image: {block.media_type || "image"}]
            </div>
          );
        }
        if (block.type === "tool_use") {
          const inputStr = JSON.stringify(block.input || {}, null, 2);
          return (
            <div className="msg-tool-use" key={i}>
              <strong>{block.name}</strong>
              <br />
              <pre style={{ margin: "4px 0 0", fontSize: "0.72rem", whiteSpace: "pre-wrap" }}>
                {inputStr.length > 500 ? inputStr.slice(0, 500) + "…" : inputStr}
              </pre>
            </div>
          );
        }
        if (block.type === "tool_result") {
          return (
            <div className="msg-tool-use" style={{ background: "#f0fdf4", borderLeft: "2px solid #22c55e" }} key={i}>
              <strong>{t("logs_tool_result_label")}</strong>
              <MessageContent content={block.content} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function MessageBlock({ msg }: { msg: LogMessage }) {
  const { t } = useI18n();
  const roleClass = msg.role === "user" ? "role-user" : "role-assistant";
  const roleLabel = msg.role === "user" ? t("logs_role_user") : t("logs_role_assistant");
  return (
    <div className={`msg-block ${roleClass}`}>
      <div className="msg-role-label">{roleLabel}</div>
      <MessageContent content={msg.content} />
    </div>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
    </svg>
  );
}

export default function LogsPage() {
  const { t, ready, lang } = useI18n();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const res = await apiFetch("/api/chat-logs");
        setSessions(await res.json());
      } catch {
        setLoadError(true);
      }
    })();
  }, [ready]);

  const selectSession = async (id: number) => {
    setActiveId(id);
    setDetail({ loading: true });
    try {
      const res = await apiFetch(`/api/chat-logs/${id}`);
      setDetail({ log: await res.json() });
    } catch {
      setDetail({ error: true });
    }
  };

  const deleteLog = async (id: number) => {
    if (!confirm(t("logs_delete_confirm"))) return;
    try {
      await apiFetch(`/api/chat-logs/${id}`, { method: "DELETE" });
      if (activeId === id) {
        setActiveId(null);
        setDetail(null);
      }
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch {
      alert("Erreur lors de la suppression.");
    }
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("logs_page_title")}</h1>
        <span className="badge-env">SESSIONS</span>
      </div>

      <div className="app-content" style={{ padding: 0, overflow: "hidden" }}>
        <div className="logs-layout">
          <div className="logs-list">
            <div className="logs-list-header">{t("logs_sessions_header")}</div>
            <div className="logs-list-body">
              {loadError && (
                <div style={{ padding: 16, color: "#dc3545", fontSize: "0.8rem" }}>{t("logs_load_error")}</div>
              )}
              {!loadError && sessions === null && (
                <div style={{ padding: 16, color: "#9ca3af", fontSize: "0.8rem" }}>{t("logs_loading")}</div>
              )}
              {!loadError && sessions?.length === 0 && (
                <div style={{ padding: 16, color: "#9ca3af", fontSize: "0.8rem" }}>{t("logs_no_logs")}</div>
              )}
              {sessions?.map((s) => {
                const tok = s.totals;
                return (
                  <div
                    className={"log-item" + (s.id === activeId ? " active" : "")}
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                  >
                    <div className="log-item-top">
                      <div className="log-item-date">{fmtDate(s.startedAt, lang)}</div>
                      <button
                        className="log-delete-btn"
                        title={t("logs_delete_title")}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLog(s.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                    <div className="log-item-stats">
                      {tok && (
                        <>
                          <span className="log-stat-badge in" title={t("logs_stat_in_title")}>
                            {fmtNum(tok.input_tokens, lang)} in
                          </span>
                          <span className="log-stat-badge out" title={t("logs_stat_out_title")}>
                            {fmtNum(tok.output_tokens, lang)} out
                          </span>
                          {tok.cache_read_input_tokens ? (
                            <span className="log-stat-badge cache" title={t("logs_stat_cache_title")}>
                              {fmtNum(tok.cache_read_input_tokens, lang)} cache
                            </span>
                          ) : null}
                          <span className="log-stat-badge calls" title={t("logs_stat_calls_title")}>
                            {tok.apiCalls} {t("logs_api_calls").toLowerCase()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="logs-detail">
            {!detail && <div className="logs-empty">{t("logs_select_session")}</div>}
            {detail?.loading && <div className="logs-empty">{t("logs_detail_loading")}</div>}
            {detail?.error && (
              <div className="logs-empty" style={{ color: "#dc3545" }}>
                {t("logs_detail_error")}
              </div>
            )}
            {detail?.log && (() => {
              const log = detail.log;
              const tok = log.totals || {};
              const calls = log.apiCalls || [];
              const messages = log.messages || [];
              return (
                <>
                  <div className="log-totals">
                    <div className="log-total-card accent-in">
                      <div className="ltc-value">{fmtNum(tok.input_tokens, lang)}</div>
                      <div className="ltc-label">{t("logs_tokens_in")}</div>
                    </div>
                    <div className="log-total-card accent-out">
                      <div className="ltc-value">{fmtNum(tok.output_tokens, lang)}</div>
                      <div className="ltc-label">{t("logs_tokens_out")}</div>
                    </div>
                    <div className="log-total-card accent-cache-create">
                      <div className="ltc-value">{fmtNum(tok.cache_creation_input_tokens, lang)}</div>
                      <div className="ltc-label">{t("logs_cache_created")}</div>
                    </div>
                    <div className="log-total-card accent-cache-read">
                      <div className="ltc-value">{fmtNum(tok.cache_read_input_tokens, lang)}</div>
                      <div className="ltc-label">{t("logs_cache_read")}</div>
                    </div>
                    <div className="log-total-card accent-calls">
                      <div className="ltc-value">{fmtNum(tok.apiCalls, lang)}</div>
                      <div className="ltc-label">{t("logs_api_calls")}</div>
                    </div>
                    <div className="log-total-card accent-tools">
                      <div className="ltc-value">{fmtNum(tok.toolsCalled, lang)}</div>
                      <div className="ltc-label">{t("logs_tools_used")}</div>
                    </div>
                    <div className="log-total-card accent-duration">
                      <div className="ltc-value">{fmtDuration(log.durationMs)}</div>
                      <div className="ltc-label">{t("logs_total_duration")}</div>
                    </div>
                  </div>

                  {calls.length > 0 && (
                    <>
                      <div className="calls-section-title">
                        {t("logs_api_calls_section")} ({calls.length})
                      </div>
                      <table className="calls-table">
                        <thead>
                          <tr>
                            <th>{t("logs_col_index")}</th>
                            <th>{t("logs_col_time")}</th>
                            <th>{t("logs_col_duration")}</th>
                            <th>{t("logs_col_input")}</th>
                            <th>{t("logs_col_output")}</th>
                            <th>{t("logs_col_cache_created")}</th>
                            <th>{t("logs_col_cache_read")}</th>
                            <th>{t("logs_col_tools")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calls.map((c) => {
                            const u = c.usage || {};
                            return (
                              <tr key={c.index}>
                                <td>{c.index}</td>
                                <td>{fmtDate(c.startedAt, lang)}</td>
                                <td>{fmtDuration(c.durationMs)}</td>
                                <td>{fmtNum(u.input_tokens, lang)}</td>
                                <td>{fmtNum(u.output_tokens, lang)}</td>
                                <td>{fmtNum(u.cache_creation_input_tokens, lang) || "—"}</td>
                                <td>{fmtNum(u.cache_read_input_tokens, lang) || "—"}</td>
                                <td>
                                  {(c.toolsCalled || []).length > 0
                                    ? c.toolsCalled!.map((tc, i) => (
                                        <span className="tool-chip" key={i}>
                                          {tc.name}
                                        </span>
                                      ))
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}

                  {messages.length > 0 && (
                    <>
                      <div className="messages-section-title">
                        {t("logs_messages_section")} ({messages.length})
                      </div>
                      {messages.map((m, i) => (
                        <MessageBlock msg={m} key={i} />
                      ))}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}
