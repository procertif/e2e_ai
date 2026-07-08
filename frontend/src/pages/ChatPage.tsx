import { useEffect, useState } from "react";
import { marked } from "marked";
import { useI18n } from "../i18n/I18nContext";
import { shortPath, toolPillClass, type ToolInput } from "../utils/toolPills";
import { environmentColorHex } from "../utils/environmentColors";
import { useChat, type AssistantItem, type PendingItem, type ToolCall } from "../chat/ChatContext";
import { ToolDiffView } from "../chat/ToolDiff";
import "../styles/chat.css";
import "../styles/environments.css";

const DIFF_CAPABLE = new Set(["write", "edit"]);

marked.setOptions({ breaks: true, gfm: true });

function formatToolLabel(name: string, input: ToolInput) {
  const n = name.toLowerCase();
  if (n === "read" && input?.file_path) return "📄 " + shortPath(input.file_path as string);
  if (n === "readimage" && input?.file_path) return "🖼 " + shortPath(input.file_path as string);
  if (n === "webfetch" && input?.url) return "🌐 " + (input.url as string).slice(0, 50) + ((input.url as string).length > 50 ? "…" : "");
  if (n === "write" && input?.file_path) return "✏️ " + shortPath(input.file_path as string);
  if (n === "edit" && input?.file_path) return "✏️ " + shortPath(input.file_path as string);
  if (n === "bash" && input?.command) return "$ " + (input.command as string).slice(0, 48) + ((input.command as string).length > 48 ? "…" : "");
  if (input?.path) return name + ": " + shortPath(input.path as string);
  if (input?.query || input?.pattern) return "🔍 " + ((input.query || input.pattern) as string).slice(0, 40);
  return name;
}

function ToolPill({ name, input, expandable, expanded, onClick }: ToolCall & { expandable: boolean; expanded: boolean; onClick?: () => void }) {
  return (
    <span
      className={`tool-pill tool-pill--${toolPillClass(name)}${expandable ? " tool-pill--expandable" : ""}${expanded ? " tool-pill--open" : ""}`}
      title={JSON.stringify(input, null, 2)}
      onClick={onClick}
    >
      {formatToolLabel(name, input)}
      {expandable && <span className="tool-pill-chevron">{expanded ? "▾" : "▸"}</span>}
    </span>
  );
}

// Renders the committed blocks of an assistant message, plus trailing live
// (not-yet-committed) text with a typing cursor while streaming. Write/Edit
// tool calls are shown expanded with a live diff by default (collapsedTools
// tracks the ones the user manually folded), so edits are visible as Claude
// makes them rather than only as an opaque pill.
function AssistantContent({
  item,
  msgIdx,
  collapsedTools,
  onToggleTool,
}: {
  item: AssistantItem;
  msgIdx: number;
  collapsedTools: Set<string>;
  onToggleTool: (key: string) => void;
}) {
  const blocks = item.blocks || [];
  let pillGroup: { name: string; input: ToolInput; bIdx: number }[] = [];
  const rendered: React.ReactNode[] = [];
  let key = 0;
  const flushPills = () => {
    if (pillGroup.length > 0) {
      const group = pillGroup;
      rendered.push(
        <div className="tool-pills" key={"pills-" + key++}>
          {group.map((b, i) => {
            const expandable = DIFF_CAPABLE.has(b.name.toLowerCase());
            const diffKey = `${msgIdx}-${b.bIdx}`;
            const isOpen = expandable && !collapsedTools.has(diffKey);
            return (
              <ToolPill
                name={b.name}
                input={b.input}
                key={i}
                expandable={expandable}
                expanded={isOpen}
                onClick={expandable ? () => onToggleTool(diffKey) : undefined}
              />
            );
          })}
        </div>,
      );
      for (const b of group) {
        const expandable = DIFF_CAPABLE.has(b.name.toLowerCase());
        const diffKey = `${msgIdx}-${b.bIdx}`;
        if (expandable && !collapsedTools.has(diffKey)) {
          rendered.push(<ToolDiffView name={b.name} input={b.input} key={"diff-" + diffKey} />);
        }
      }
      pillGroup = [];
    }
  };
  blocks.forEach((b, bIdx) => {
    if (b.type === "tool") {
      pillGroup.push({ name: b.name, input: b.input, bIdx });
    } else {
      flushPills();
      if (b.text) {
        rendered.push(<div className="msg-content" key={"text-" + key++} dangerouslySetInnerHTML={{ __html: marked.parse(b.text) as string }} />);
      }
    }
  });
  flushPills();

  const showThinking = blocks.length === 0 && !item.liveText && !item.done;
  if (showThinking) {
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

export default function ChatPage() {
  const { t } = useI18n();
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
  } = useChat();

  // Autofocus only when this route is actually visited — the chat state
  // itself lives in ChatProvider and survives switching to other tabs.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [timeline, messagesRef]);

  return (
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

      <div className="chat-messages" ref={messagesRef}>
        {!hasContent && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" fill="#6366f1" viewBox="0 0 16 16">
                <path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8 8 0 0 0 8 14c3.996 0 7-2.807 7-6s-3.004-6-7-6-7 2.808-7 6c0 1.468.617 2.83 1.678 3.894m-.493 3.905a22 22 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a10 10 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9 9 0 0 1-2.088-.243 4.4 4.4 0 0 1-1.716.83" />
              </svg>
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
            return (
              <div className="chat-message chat-message--assistant" key={idx}>
                <div className="msg-bubble msg-bubble--assistant">
                  <AssistantContent item={item} msgIdx={idx} collapsedTools={collapsedTools} onToggleTool={toggleTool} />
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 16 16"
            style={{ transform: instructionsOpen ? "rotate(180deg)" : "" }}
          >
            <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z" />
          </svg>
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
            <p className="instructions-hint">{t("instructions_hint")}</p>
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
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.502 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" />
              <path d="M14.002 13a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2V5A2 2 0 0 1 2 3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-1.998 2M14 2H4a1 1 0 0 0-1 1h9.002a2 2 0 0 1 2 2v7A1 1 0 0 0 15 11V3a1 1 0 0 0-1-1M2.002 4a1 1 0 0 0-1 1v8l2.646-2.354a.5.5 0 0 1 .63-.062l2.66 1.773 3.71-3.71a.5.5 0 0 1 .577-.094l1.777 1.947V5a1 1 0 0 0-1-1z" />
            </svg>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5" />
              </svg>
            </button>
          ) : (
            <button className="chat-send-btn" disabled={sendDisabled} title={t("btn_send_title")} onClick={sendMessage}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z" />
              </svg>
            </button>
          )}
        </div>
        <p className="chat-hint">{t("chat_input_hint")}</p>
      </div>

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
