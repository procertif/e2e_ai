import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { marked } from "marked";
import { apiFetch, apiStreamUrl } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { escHtml, fuzzyMatch } from "../utils/format";
import { formatToolLabel, toolPillClass, type ToolInput } from "../utils/toolPills";
import type { Test, ScenarioAction, ScenarioData } from "../types";
import "../styles/groups.css";
import "../styles/chat.css";
import "../styles/scenarios.css";

marked.setOptions({ breaks: true, gfm: true });

const GHERKIN_KEYWORDS = ["Étant donné", "Étant donnés", "Étant données", "Quand", "Lorsque", "Alors", "Et", "Mais"];

interface PromptMessage {
  role: string;
  content: string | { type: string; text?: string }[];
}

interface DrawerTool {
  name: string;
  input: ToolInput;
}

interface DrawerMessage {
  role: "user" | "assistant";
  text: string;
  tools?: DrawerTool[];
  done?: boolean;
}

interface DrawerCtx {
  action: ScenarioAction;
  testFile: string;
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

function messageText(m: PromptMessage) {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n");
  }
  return "";
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
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z" />
            <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z" />
          </svg>
          {showLabel && <span>{labelText}</span>}
        </>
      )}
    </button>
  );
}

export default function ScenariosPage() {
  const { t, ready } = useI18n();
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioData | null>(null);
  const [promptMessages, setPromptMessages] = useState<PromptMessage[] | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [spec, setSpec] = useState<SpecState>({ state: "idle", text: "" });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCtx, setDrawerCtx] = useState<DrawerCtx | null>(null);
  const [drawerMessages, setDrawerMessages] = useState<DrawerMessage[]>([]);
  const [drawerStreaming, setDrawerStreaming] = useState(false);
  const [drawerInput, setDrawerInput] = useState("");
  const drawerSessionId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const res = await apiFetch("/api/tests");
      setAllTests(await res.json());
    })();
  }, [ready]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [drawerMessages]);

  const filteredTests = allTests.filter((tst) => fuzzyMatch(tst.alias || tst.name, query));

  const selectTest = async (filename: string) => {
    setSelectedTest(filename);
    const testKey = filename.replace(/\.spec\.ts$/, "");
    try {
      const res = await apiFetch(`/api/actions/${encodeURIComponent(testKey)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setScenario(data);
      loadPrompt(testKey);
      loadSpec(testKey);
    } catch {
      setScenario(null);
    }
  };

  const loadPrompt = async (testKey: string) => {
    setPromptMessages(null);
    try {
      const res = await apiFetch(`/api/prompt/${encodeURIComponent(testKey)}`);
      if (!res.ok) throw new Error();
      setPromptMessages(await res.json());
    } catch {
      setPromptMessages(null);
    }
  };

  const loadSpec = async (testKey: string) => {
    setSpec({ state: "loading", text: "" });
    try {
      const res = await apiFetch(`/api/spec/${encodeURIComponent(testKey)}`);
      if (!res.ok) throw new Error();
      const { spec: specText } = await res.json();
      setSpec({ state: "ready", text: specText });
    } catch {
      setSpec({ state: "unavailable", text: "" });
    }
  };

  const downloadTxt = () => {
    if (!scenario) return;
    const lines = [`Test : ${scenario.test}`, `Fichier : ${scenario.file}`, "", ...scenario.actions.map((a) => a.description)];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.test}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Chat drawer ──

  const openDrawer = (action: ScenarioAction) => {
    if (!scenario) return;
    setDrawerCtx({ action, testFile: scenario.file });
    drawerSessionId.current = null;
    setDrawerMessages([]);
    setDrawerInput("");
    setDrawerStreaming(false);
    setDrawerOpen(true);
    const initMsg = `Lis le fichier \`/home/procertif/e2e_ai/data/tests/${scenario.file}\` et aide-moi à modifier l'étape ${action.index} (ligne ${action.line}) : **${action.description}**.`;
    sendDrawerMessage(initMsg);
  };

  const closeDrawer = () => setDrawerOpen(false);

  const resetDrawer = () => {
    drawerSessionId.current = null;
    setDrawerMessages([]);
    setDrawerInput("");
    setDrawerStreaming(false);
  };

  const sendDrawerMessage = async (text: string) => {
    if (!text || drawerStreaming) return;
    setDrawerStreaming(true);
    setDrawerMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "", tools: [], done: false }]);

    const instructions = localStorage.getItem("procertif_instructions") || "";

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, sessionId: drawerSessionId.current, instructions: instructions || null }),
      });
      if (!res.ok) throw new Error("Erreur serveur " + res.status);
      const { runId } = await res.json();

      const es = new EventSource(apiStreamUrl(`/api/chat-stream/${runId}`));
      es.onmessage = (evt) => {
        let ev;
        try {
          ev = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (ev.type === "delta") {
          setDrawerMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + ev.text };
            return next;
          });
        } else if (ev.type === "tool_start") {
          setDrawerMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, tools: [...(last.tools || []), { name: ev.name, input: ev.input || null }] };
            return next;
          });
        } else if (ev.type === "done") {
          if (ev.sessionId) drawerSessionId.current = ev.sessionId;
          setDrawerMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text || "*(Aucune réponse)*", done: true };
            return next;
          });
          es.close();
          setDrawerStreaming(false);
        }
      };
      es.onerror = () => {
        setDrawerMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, text: last.text || "*(Erreur de connexion)*", done: true };
          return next;
        });
        es.close();
        setDrawerStreaming(false);
      };
    } catch (err) {
      setDrawerMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", text: `*(Erreur : ${err instanceof Error ? err.message : String(err)})*`, tools: [], done: true };
        return next;
      });
      setDrawerStreaming(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDrawerInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (drawerInput.trim() && !drawerStreaming) {
        sendDrawerMessage(drawerInput.trim());
        setDrawerInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      }
    }
  };

  const handleSendClick = () => {
    if (drawerInput.trim() && !drawerStreaming) {
      sendDrawerMessage(drawerInput.trim());
      setDrawerInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    }
  };

  const stepCount = scenario?.actions.length || 0;
  const stepLabel = stepCount > 1 ? t("scenario_count_plural") : t("scenario_count_singular");

  const promptText = (m: PromptMessage) => messageText(m);
  const allPromptText = () =>
    (promptMessages || [])
      .map((m) => messageText(m))
      .filter(Boolean)
      .join("\n\n---\n\n");

  return (
    <div className="app-content">
      <div className="panels-layout">
        <div className="panel panel-available">
          <div className="panel-header">
            <div className="d-flex align-items-center justify-content-between">
              <h2 className="panel-title">{t("nav_tests")}</h2>
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
                placeholder={t("search_scenarios_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="panel-body">
            <div id="test-list">
              {filteredTests.map((tst) => (
                <div
                  key={tst.filename}
                  className={"test-item scenario-test-item" + (selectedTest === tst.filename ? " selected" : "")}
                  onClick={() => selectTest(tst.filename)}
                >
                  <span className="test-name">{tst.alias || tst.name}</span>
                  <span className="test-file">{tst.filename}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel panel-scenarios">
          {!scenario && (
            <div className="scenario-empty">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="currentColor" viewBox="0 0 16 16" style={{ opacity: 0.2 }}>
                <path
                  fillRule="evenodd"
                  d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2"
                />
              </svg>
              <p>{t("scenario_empty_message")}</p>
            </div>
          )}

          {scenario && (
            <div style={{ height: "100%", overflowY: "auto", padding: "1.25rem 1.5rem" }}>
              <div className="scenario-header">
                <div>
                  <h2 className="scenario-title">{scenario.test}</h2>
                  <span className="scenario-file">{scenario.file}</span>
                </div>
                <div className="scenario-header-actions">
                  <span className="scenario-count">
                    {stepCount} {stepLabel}
                  </span>
                  <button className="scenario-download-btn" title={t("btn_download_title")} onClick={downloadTxt}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
                      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z" />
                    </svg>
                    .txt
                  </button>
                </div>
              </div>

              {promptMessages && promptMessages.length > 0 && (
                <div className="scenario-prompt">
                  <div className="spec-header">
                    <div className="scenario-prompt-toggle" onClick={() => setPromptOpen((v) => !v)}>
                      <span className="spec-label">{t("spec_label_prompt")}</span>
                      <span className="prompt-chevron" style={{ transform: promptOpen ? "rotate(90deg)" : "" }}>
                        ›
                      </span>
                    </div>
                    <CopyButton text={allPromptText()} title={t("btn_copy_all_title")} showLabel labelText={t("btn_copy_all")} />
                  </div>
                  {promptOpen && (
                    <div className="prompt-body">
                      {promptMessages.map((m, i) => (
                        <div className="prompt-message-wrap" key={i}>
                          <div className="prompt-message">{promptText(m)}</div>
                          <CopyButton text={promptText(m)} title={t("btn_copy")} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="scenario-spec">
                <div className="spec-header">
                  <span className="spec-label">{t("spec_label_expected")}</span>
                  <CopyButton text={spec.text} title={t("btn_copy")} showLabel labelText={t("btn_copy")} />
                </div>
                <div className="spec-body">
                  {spec.state === "ready" ? (
                    <span dangerouslySetInnerHTML={{ __html: renderGherkin(spec.text) }} />
                  ) : (
                    <span className="spec-generating">
                      {spec.state === "unavailable" ? t("spec_unavailable") : t("spec_generating")}
                    </span>
                  )}
                </div>
              </div>

              <ol className="scenario-steps">
                {scenario.actions.map((a) => (
                  <li className={"scenario-step" + (drawerOpen && drawerCtx?.action.index === a.index ? " step-active" : "")} key={a.index}>
                    <div className="step-body">
                      <span className="step-desc">{a.description}</span>
                      <div className="step-meta">
                        <span className="step-line">
                          {t("step_line_prefix")} {a.line}
                        </span>
                        <button className="step-edit-btn" title={t("btn_modify_title")} onClick={() => openDrawer(a)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894m-.493 3.905a22 22 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a10 10 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9 9 0 0 1-2.088-.243 4.4 4.4 0 0 1-1.716.83" />
                          </svg>
                          {t("btn_modify_with_claude")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>

      <div className={"drawer-backdrop" + (drawerOpen ? " is-open" : "")} onClick={closeDrawer} />

      <div className={"chat-drawer" + (drawerOpen ? " is-open" : "")}>
        <div className="chat-drawer-header">
          <div className="chat-drawer-ctx">
            <span className="ctx-badge">
              {drawerCtx ? `${t("scenario_count_singular").charAt(0).toUpperCase()}${t("scenario_count_singular").slice(1)} ${drawerCtx.action.index}` : ""}
            </span>
            <span className="ctx-desc">{drawerCtx?.action.description || ""}</span>
            <span className="ctx-line">{drawerCtx ? `${t("step_line_prefix")} ${drawerCtx.action.line}` : ""}</span>
          </div>
          <div className="chat-drawer-btns">
            <button className="drawer-icon-btn" title={t("drawer_new_conversation_title")} onClick={resetDrawer}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4" />
              </svg>
            </button>
            <button className="drawer-icon-btn" title={t("btn_close_drawer_title")} onClick={closeDrawer}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="chat-drawer-messages" ref={messagesRef}>
          {drawerMessages.map((m, i) =>
            m.role === "user" ? (
              <div className="dmsg dmsg--user" key={i}>
                <div className="dmsg-bubble dmsg-bubble--user">{m.text}</div>
              </div>
            ) : (
              <div className="dmsg dmsg--assistant" key={i}>
                <div className="dmsg-bubble dmsg-bubble--assistant">
                  {!m.done && !m.text && (!m.tools || m.tools.length === 0) ? (
                    <div className="thinking-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : (
                    <>
                      {m.tools && m.tools.length > 0 && (
                        <div className="tool-pills" style={{ display: "flex" }}>
                          {m.tools.map((tool, ti) => (
                            <span
                              className={`tool-pill tool-pill--${toolPillClass(tool.name)}`}
                              title={JSON.stringify(tool.input, null, 2)}
                              key={ti}
                            >
                              {formatToolLabel(tool.name, tool.input)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="dmsg-content">
                        <span dangerouslySetInnerHTML={{ __html: m.text ? (marked.parse(m.text) as string) : "" }} />
                        {!m.done && <span className="typing-cursor">▋</span>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        <div className="chat-drawer-footer">
          <div className={"chat-drawer-input-wrap" + (drawerStreaming ? " is-streaming" : "")}>
            <textarea
              ref={inputRef}
              className="drawer-textarea"
              placeholder={t("drawer_input_placeholder")}
              rows={1}
              value={drawerInput}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
            />
            <button className="drawer-send-btn" disabled={drawerStreaming || !drawerInput.trim()} onClick={handleSendClick}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z" />
              </svg>
            </button>
          </div>
          <p className="chat-hint">{t("chat_hint")}</p>
        </div>
      </div>
    </div>
  );
}
