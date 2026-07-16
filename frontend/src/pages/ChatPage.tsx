import { useEffect, useState } from "react";
import { marked } from "marked";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots, faChevronDown, faImage, faStop, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "../i18n/I18nContext";
import { toolPillClass, type ToolInput } from "../utils/toolPills";
import { toolLabel, readFileLineInfo, findSelectorMatches, type EntityTitles } from "../utils/toolNarration";
import { useEntityTitles } from "../utils/useEntityTitles";
import { useStickyScroll } from "../utils/useStickyScroll";
import { environmentColorHex } from "../utils/environmentColors";
import { RepoUpdateBanner, RepoUpdateIcon } from "../environment/RepoUpdateBanner";
import { AiQueuePausedBanner } from "../ai/AiQueuePausedBanner";
import { useChat, type AssistantItem, type PendingItem } from "../chat/ChatContext";
import { ToolDiffView } from "../chat/ToolDiff";
import { ToolConsole } from "../chat/ToolConsole";
import "../styles/chat.css";
import "../styles/environments.css";

const DIFF_CAPABLE = new Set(["writetestfile"]);

marked.setOptions({ breaks: true, gfm: true });

function ToolPill({
  name,
  label,
  input,
  expandable,
  expanded,
  spinning,
  suffix,
  onClick,
}: {
  name: string;
  label: string;
  input: ToolInput;
  expandable: boolean;
  expanded: boolean;
  spinning?: boolean;
  suffix?: string;
  onClick?: () => void;
}) {
  return (
    <span
      className={`tool-pill tool-pill--${toolPillClass(name)}${expandable ? " tool-pill--expandable" : ""}${expanded ? " tool-pill--open" : ""}`}
      title={JSON.stringify(input, null, 2)}
      onClick={onClick}
    >
      {spinning && <span className="spinner-border spinner-xs tool-pill-spinner" role="status" aria-hidden="true" />}
      {label}
      {suffix && <span className="tool-pill-suffix"> — {suffix}</span>}
      {expandable && <span className="tool-pill-chevron">{expanded ? "▾" : "▸"}</span>}
    </span>
  );
}

// Renders the committed blocks of an assistant message, plus trailing live
// (not-yet-committed) text with a typing cursor while streaming. Each tool
// call and each paragraph gets its own line — no more side-by-side pill
// grouping. Write/Edit tool calls are shown expanded with a live diff by
// default (collapsedTools tracks the ones the user manually folded); RunTest
// shows its console output, FindSelector its matched lines, ReadDataFile a
// line-count once the result is back, all inline rather than an opaque pill.
function AssistantContent({
  item,
  msgIdx,
  collapsedTools,
  onToggleTool,
  queuePosition,
  titles,
}: {
  item: AssistantItem;
  msgIdx: number;
  collapsedTools: Set<string>;
  onToggleTool: (key: string) => void;
  queuePosition?: number | null;
  titles: EntityTitles;
}) {
  const { t } = useI18n();
  const blocks = item.blocks || [];
  const rendered: React.ReactNode[] = [];
  let key = 0;

  blocks.forEach((b, bIdx) => {
    const isLast = bIdx === blocks.length - 1;
    const spinning = isLast && !item.done && !item.liveText;

    if (b.type === "tool") {
      const n = b.name.toLowerCase();
      const expandable = DIFF_CAPABLE.has(n);
      const diffKey = `${msgIdx}-${bIdx}`;
      const isOpen = expandable && !collapsedTools.has(diffKey);
      const lineInfo = n === "readdatafile" ? readFileLineInfo(b.input, b.result) : null;
      const matches = n === "findselector" ? findSelectorMatches(b.result) : [];

      rendered.push(
        <div className="tool-row" key={"tool-" + key++}>
          <ToolPill
            name={b.name}
            label={toolLabel(b.name, b.input, titles)}
            input={b.input}
            expandable={expandable}
            expanded={isOpen}
            spinning={spinning}
            suffix={lineInfo || undefined}
            onClick={expandable ? () => onToggleTool(diffKey) : undefined}
          />
          {expandable && isOpen && <ToolDiffView name={b.name} input={b.input} />}
          {n === "runtest" && b.result && <ToolConsole text={b.result} />}
          {matches.length > 0 && (
            <div className="tool-matches">
              {matches.map((m, i) => (
                <div className="tool-match-row" key={i}>
                  {m.file} — {m.lines.length === 1 ? `ligne ${m.lines[0]}` : `lignes ${m.lines.join(", ")}`}
                </div>
              ))}
            </div>
          )}
        </div>,
      );
    } else if (b.type === "image") {
      rendered.push(
        <img src={`data:${b.media_type};base64,${b.data}`} className="msg-image msg-tool-image" key={"img-" + key++} alt="" />,
      );
    } else if (b.text) {
      rendered.push(<div className="msg-content" key={"text-" + key++} dangerouslySetInnerHTML={{ __html: marked.parse(b.text) as string }} />);
    }
  });

  const showThinking = blocks.length === 0 && !item.liveText && !item.done;
  if (showThinking) {
    if (queuePosition != null) {
      return (
        <div className="chat-queued-hint">
          <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />
          {t("chat_queued_hint").replace("{n}", String(queuePosition + 1))}
        </div>
      );
    }
    return (
      <div className="thinking-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    );
  }

  return (
    <>
      {rendered}
      {!item.done && item.liveText && (
        <div className="msg-content">
          <span dangerouslySetInnerHTML={{ __html: marked.parse(item.liveText) as string }} />
          <span className="typing-cursor">▋</span>
        </div>
      )}
    </>
  );
}

function PendingCard({
  item,
  onRun,
  onConfirm,
  onDiscard,
}: {
  item: PendingItem;
  onRun: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  if (item.status === "confirmed" || item.status === "discarded") {
    return (
      <div className="pending-card pending-card--done">
        <div className="pending-header">
          <span>
            {item.status === "confirmed" ? t("pending_applied") : t("pending_cancelled")} <code>{item.testname}.spec.ts</code>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="pending-card">
      <div className="pending-header">
        <span className="pending-icon">⏳</span>
        <span className="pending-title">{t("pending_title")}</span>
        <code className="pending-file">{item.testname}.spec.ts</code>
      </div>
      {item.output !== undefined && (
        <pre className="pending-output" style={{ display: "block" }}>
          {item.output}
        </pre>
      )}
      <div className="pending-actions">
        <button className="pending-btn pending-btn--run" onClick={onRun}>
          {item.ran ? t("btn_retest") : t("btn_test")}
        </button>
        <button className="pending-btn pending-btn--confirm" onClick={onConfirm}>
          {t("btn_confirm")}
        </button>
        <button className="pending-btn pending-btn--discard" onClick={onDiscard}>
          {t("btn_discard")}
        </button>
      </div>
    </div>
  );
}

function fmtConversationDate(iso: string, lang: string) {
  const d = new Date(iso);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return (
    d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  );
}

export default function ChatPage() {
  const { t, lang } = useI18n();
  const titles = useEntityTitles();
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());
  const toggleTool = (key: string) => {
    setCollapsedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const {
    timeline,
    isStreaming,
    queuePosition,
    inputValue,
    pendingImages,
    setPendingImages,
    instructions,
    instructionsOpen,
    setInstructionsOpen,
    dragOver,
    setDragOver,
    saveModal,
    setSaveModal,
    messagesRef,
    inputRef,
    imageInputRef,
    handleInstructionsChange,
    resetInstructions,
    addFiles,
    handleInputChange,
    handleInputKeyDown,
    handlePaste,
    resetChat,
    sendMessage,
    stopStreaming,
    runPending,
    confirmPending,
    discardPending,
    openSaveModal,
    closeSaveModal,
    doSave,
    hasContent,
    sendDisabled,
    environments,
    selectedId,
    setSelectedId,
    selectedEnvironment,
    sessionId,
    conversations,
    loadConversation,
  } = useChat();

  // Autofocus only when this route is actually visited — the chat state
  // itself lives in ChatProvider and survives switching to other tabs.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  useStickyScroll(timeline, messagesRef);

  return (
    <div className="chat-with-history">
    <div className="chat-layout">
      <div className="chat-header">
        <div className="chat-header-info">
          <h1 className="chat-title">{t("chat_page_title")}</h1>
          <span className="chat-scope">{t("chat_scope")}</span>
        </div>
        <div className="chat-header-actions">
          <div className="target-environment-bar" style={{ marginBottom: 0, flexDirection: "column", alignItems: "flex-start", gap: "0.2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="environment-color-dot" style={{ background: selectedEnvironment ? environmentColorHex(selectedEnvironment.color) : "#ced4da" }} />
              <label className="target-environment-label" htmlFor="chat-target-environment-select">
                {t("target_environment_label")}
              </label>
              <select
                id="chat-target-environment-select"
                className={"form-select form-select-sm target-environment-select" + (selectedId == null ? " is-required" : "")}
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t("target_environment_none_option")}</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <RepoUpdateIcon environment={selectedEnvironment} />
            </div>
            {selectedId == null && <span className="target-environment-hint">{t("target_environment_required_hint")}</span>}
          </div>
          <button className="btn btn-sm btn-outline-secondary" disabled={!hasContent} onClick={openSaveModal}>
            {t("btn_save_chat")}
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={resetChat}>
            {t("btn_new_chat")}
          </button>
        </div>
      </div>

      <div style={{ padding: selectedEnvironment?.hasUpdate ? "0.75rem 2rem 0" : 0 }}>
        <RepoUpdateBanner environment={selectedEnvironment} />
      </div>

      <div style={{ padding: "0 2rem" }}>
        <AiQueuePausedBanner />
      </div>

      <div className="chat-messages" ref={messagesRef}>
        {!hasContent && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">
              <FontAwesomeIcon icon={faCommentDots} style={{ fontSize: 26, color: "#6366f1" }} />
            </div>
            <p>{t("chat_welcome_message")}</p>
          </div>
        )}

        {timeline.map((item, idx) => {
          if (item.kind === "user") {
            return (
              <div className="chat-message chat-message--user" key={idx}>
                <div className="msg-bubble msg-bubble--user">
                  {item.images.length > 0 && (
                    <div className="msg-images">
                      {item.images.map((img, i) => (
                        <img src={`data:${img.media_type};base64,${img.data}`} className="msg-image" key={i} alt="" />
                      ))}
                    </div>
                  )}
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.kind === "assistant") {
            const isLast = idx === timeline.length - 1;
            return (
              <div className="chat-message chat-message--assistant" key={idx}>
                <div className="msg-bubble msg-bubble--assistant">
                  <AssistantContent
                    item={item}
                    msgIdx={idx}
                    collapsedTools={collapsedTools}
                    onToggleTool={toggleTool}
                    queuePosition={isLast ? queuePosition : null}
                    titles={titles}
                  />
                </div>
              </div>
            );
          }
          return (
            <PendingCard
              item={item}
              key={idx}
              onRun={() => runPending(idx, item.testname)}
              onConfirm={() => confirmPending(idx, item.testname)}
              onDiscard={() => discardPending(idx, item.testname)}
            />
          );
        })}
      </div>

      <div className="chat-instructions-bar">
        <button className="instructions-toggle" type="button" onClick={() => setInstructionsOpen((v) => !v)}>
          <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: 12, transform: instructionsOpen ? "rotate(180deg)" : "" }} />
          <span>{t("instructions_toggle_label")}</span>
          {instructions.trim() && <span className="instructions-badge">{t("instructions_badge_active")}</span>}
        </button>
        {instructionsOpen && (
          <div className="instructions-body">
            <textarea
              className="instructions-textarea"
              placeholder={t("instructions_placeholder")}
              rows={3}
              value={instructions}
              onChange={handleInstructionsChange}
            />
            <div className="d-flex align-items-center justify-content-between">
              <p className="instructions-hint">{t("instructions_hint")}</p>
              <button className="btn btn-sm btn-outline-secondary" onClick={resetInstructions}>
                {t("btn_reset_instructions")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-area">
        <input
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          ref={imageInputRef}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {pendingImages.length > 0 && (
          <div className="image-previews" style={{ display: "flex" }}>
            {pendingImages.map((img, i) => (
              <div className="image-preview-item" key={i}>
                <img src={`data:${img.media_type};base64,${img.data}`} alt={img.name || "image"} />
                <button
                  className="image-preview-remove"
                  title={t("image_remove_title")}
                  onClick={() => setPendingImages((prev) => prev.filter((_, pi) => pi !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={"chat-input-wrap" + (isStreaming ? " is-streaming" : "") + (dragOver ? " drag-over" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <button className="chat-attach-btn" title={t("btn_attach_title")} onClick={() => imageInputRef.current?.click()}>
            <FontAwesomeIcon icon={faImage} style={{ fontSize: 16 }} />
          </button>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={t("chat_input_placeholder")}
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
          />
          {isStreaming ? (
            <button className="chat-send-btn chat-stop-btn" title={t("btn_stop_title")} onClick={stopStreaming}>
              <FontAwesomeIcon icon={faStop} style={{ fontSize: 14 }} />
            </button>
          ) : (
            <button className="chat-send-btn" disabled={sendDisabled} title={t("btn_send_title")} onClick={sendMessage}>
              <FontAwesomeIcon icon={faPaperPlane} style={{ fontSize: 16 }} />
            </button>
          )}
        </div>
        <p className="chat-hint">{t("chat_input_hint")}</p>
      </div>
    </div>

    <aside className="chat-history-panel">
      <div className="chat-history-header">
        <span>{t("chat_history_title")}</span>
        <button className="btn btn-sm btn-outline-secondary" onClick={resetChat}>
          {t("btn_new_chat")}
        </button>
      </div>
      <div className="chat-history-list">
        {conversations.length === 0 && <p className="chat-history-empty">{t("chat_history_empty")}</p>}
        {conversations.map((c) => (
          <button
            key={c.conversationId}
            className={"chat-history-item" + (c.latestRunId === sessionId ? " active" : "")}
            onClick={() => loadConversation(c.latestChatLogId)}
          >
            <span className="chat-history-item-title">{c.title || t("chat_history_untitled")}</span>
            <span className="chat-history-item-meta">
              {fmtConversationDate(c.updatedAt, lang)} · {c.messageCount} {c.messageCount > 1 ? t("chat_history_messages_plural") : t("chat_history_messages_singular")}
            </span>
          </button>
        ))}
      </div>
    </aside>

      {saveModal && (
        <div className="save-modal-backdrop" style={{ display: "flex" }} onClick={(e) => e.target === e.currentTarget && closeSaveModal()}>
          <div className="save-modal is-open" role="dialog" aria-modal="true">
            <div className="save-modal-header">
              <span className="save-modal-title">{t("save_modal_title")}</span>
              <button className="save-modal-close" aria-label={t("save_modal_close_aria")} onClick={closeSaveModal}>
                &times;
              </button>
            </div>
            <div className="save-modal-body">
              <label className="save-modal-label">{t("save_filename_label")}</label>
              <div className="save-filename-wrap">
                <input
                  type="text"
                  className="save-filename-input"
                  placeholder={t("save_filename_placeholder")}
                  autoComplete="off"
                  spellCheck="false"
                  autoFocus
                  value={saveModal.filename}
                  onChange={(e) => setSaveModal({ ...saveModal, filename: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSave();
                  }}
                />
                <span className="save-filename-ext">.json</span>
              </div>
              {saveModal.error && <p className="save-modal-error" style={{ display: "block" }}>{saveModal.error}</p>}
            </div>
            <div className="save-modal-footer">
              <button className="btn btn-sm btn-outline-secondary" onClick={closeSaveModal}>
                {t("btn_save_cancel")}
              </button>
              <button className="btn btn-sm btn-primary" disabled={saveModal.saving} onClick={doSave}>
                {saveModal.saving ? t("btn_saving") : t("btn_save_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
