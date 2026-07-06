import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { marked } from "marked";
import { apiFetch, apiStreamUrl } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { shortPath, toolPillClass, type ToolInput } from "../utils/toolPills";
import "../styles/chat.css";

marked.setOptions({ breaks: true, gfm: true });

const CHAT_STORAGE_KEY = "procertif_chat";
const INSTRUCTIONS_STORAGE_KEY = "procertif_instructions";

const DEFAULT_INSTRUCTIONS = `Tu dois TOUJOURS regrouper les appels d'outils indépendants dans le même bloc
pour les exécuter en parallèle. Ne jamais appeler les outils séquentiellement
si leurs entrées ne dépendent pas les unes des autres.

Les tests sont toujours en playwright natif et tu dois toujours chercher dans le code et t'inspirer des tests déjà existant.

Toujours prendre un screenshot entre chaque action dans les tests.

Dans les fichiers de test Playwright, ajoute un commentaire structuré avant chaque action utilisateur (navigation, clic, saisie, attente) au format :
// ACTION: <description courte en français>
Ne commente pas les screenshots, les déclarations de variables, la configuration ni les utilitaires (mkdirSync, setTimeout…).
Ce balisage permet de générer un fichier JSON listant les étapes du test dans l'ordre pour pouvoir les modifier facilement.
Tu dois toujours générer ce json quand tu génères un test. Le json doit être dans /app/data/actionTest.
Tu dois également générer un fichier .md dans /app/data/specs pour stocker le scénario au format naturel.
Tu dois aussi générer un autre json dans /app/data/promptTest qui sauvegarde la conversation qu'il y a eu pour écrire le test.
Pour ces 3 fichiers, tu dois t'inspirer du format des fichiers déjà existant.
`;

interface PendingImage {
  data: string;
  media_type: string;
  name: string;
}

interface ToolCall {
  name: string;
  input: ToolInput;
}

type AssistantBlock = { type: "tool"; name: string; input: ToolInput } | { type: "text"; text: string };

interface UserItem {
  kind: "user";
  text: string;
  images: { data: string; media_type: string }[];
}

interface AssistantItem {
  kind: "assistant";
  blocks: AssistantBlock[];
  liveText: string;
  tools: ToolCall[];
  done: boolean;
}

interface PendingItem {
  kind: "pending";
  testname: string;
  status: "open" | "confirmed" | "discarded";
  output?: string;
  ran: boolean;
}

type TimelineItem = UserItem | AssistantItem | PendingItem;

interface SaveModalState {
  filename: string;
  error: string | null;
  saving: boolean;
}

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

function ToolPill({ name, input }: ToolCall) {
  return (
    <span className={`tool-pill tool-pill--${toolPillClass(name)}`} title={JSON.stringify(input, null, 2)}>
      {formatToolLabel(name, input)}
    </span>
  );
}

// Renders the committed blocks of an assistant message, plus trailing live
// (not-yet-committed) text with a typing cursor while streaming.
function AssistantContent({ item }: { item: AssistantItem }) {
  const blocks = item.blocks || [];
  let pillGroup: { name: string; input: ToolInput }[] = [];
  const rendered: React.ReactNode[] = [];
  let key = 0;
  const flushPills = () => {
    if (pillGroup.length > 0) {
      rendered.push(
        <div className="tool-pills" key={"pills-" + key++}>
          {pillGroup.map((b, i) => (
            <ToolPill name={b.name} input={b.input} key={i} />
          ))}
        </div>,
      );
      pillGroup = [];
    }
  };
  for (const b of blocks) {
    if (b.type === "tool") {
      pillGroup.push(b);
    } else {
      flushPills();
      if (b.text) {
        rendered.push(<div className="msg-content" key={"text-" + key++} dangerouslySetInnerHTML={{ __html: marked.parse(b.text) as string }} />);
      }
    }
  }
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
  const { t, ready } = useI18n();
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [instructions, setInstructions] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saveModal, setSaveModal] = useState<SaveModalState | null>(null);

  const currentRunId = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "null");
      if (saved?.messages?.length) {
        setSessionId(saved.sessionId || null);
        setTimeline(
          saved.messages.map(
            (msg: any): TimelineItem =>
              msg.role === "user"
                ? { kind: "user", text: msg.content, images: msg.images || [] }
                : {
                    kind: "assistant",
                    blocks: msg.blocks?.length ? msg.blocks : [...(msg.tools || []).map((tl: ToolCall) => ({ type: "tool", ...tl })), ...(msg.content ? [{ type: "text", text: msg.content }] : [])],
                    liveText: "",
                    tools: msg.tools || [],
                    done: true,
                  },
          ),
        );
      }
    } catch {}
    const savedInstr = localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
    setInstructions(savedInstr !== null ? savedInstr : DEFAULT_INSTRUCTIONS);
    inputRef.current?.focus();
  }, [ready]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [timeline]);

  const persistChat = (nextTimeline: TimelineItem[], nextSessionId: string | null) => {
    const messages = nextTimeline
      .filter((item): item is UserItem | AssistantItem => item.kind !== "pending")
      .map((item) =>
        item.kind === "user"
          ? { role: "user", content: item.text, images: item.images.length > 0 ? item.images : undefined }
          : { role: "assistant", content: (item.blocks || []).filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""), tools: item.tools, blocks: item.blocks },
      );
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ sessionId: nextSessionId, messages }));
    } catch {}
  };

  const handleInstructionsChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInstructions(e.target.value);
    localStorage.setItem(INSTRUCTIONS_STORAGE_KEY, e.target.value);
  };

  const readImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target!.result as string;
      const [prefix, data] = dataUrl.split(",");
      const media_type = prefix.match(/:(.*?);/)![1];
      setPendingImages((prev) => [...prev, { data, media_type, name: file.name }]);
    };
    reader.readAsDataURL(file);
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of fileList) {
      if (file.type.startsWith("image/")) readImageFile(file);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (inputValue.trim() || pendingImages.length > 0)) sendMessage();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = [...items].filter((i) => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) readImageFile(file);
    }
  };

  const resetChat = () => {
    setSessionId(null);
    setTimeline([]);
    setPendingImages([]);
    localStorage.removeItem(CHAT_STORAGE_KEY);
  };

  const sendMessage = async () => {
    const text = inputValue.trim();
    if ((!text && pendingImages.length === 0) || isStreaming) return;

    const imagesToSend = pendingImages.map(({ data, media_type }) => ({ data, media_type }));
    setPendingImages([]);
    setIsStreaming(true);
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    // Timeline is append-only and this handler can't overlap with another
    // send (guarded by isStreaming), so the new assistant item's index is
    // deterministic from the current render's `timeline` length.
    const assistantIndex = timeline.length + 1;
    setTimeline((prev) => [
      ...prev,
      { kind: "user", text, images: imagesToSend },
      { kind: "assistant", blocks: [], liveText: "", tools: [], done: false },
    ]);

    const updateAssistant = (updater: (item: AssistantItem) => AssistantItem) => {
      setTimeline((prev) => {
        const next = [...prev];
        next[assistantIndex] = updater(next[assistantIndex] as AssistantItem);
        return next;
      });
    };

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, images: imagesToSend.length > 0 ? imagesToSend : null, sessionId, instructions: instructions.trim() || null }),
      });
      if (!res.ok) throw new Error(t("save_error_server") + " " + res.status);
      const { runId } = await res.json();
      currentRunId.current = runId;

      const es = new EventSource(apiStreamUrl(`/api/chat-stream/${runId}`));

      es.onmessage = (evt) => {
        let event;
        try {
          event = JSON.parse(evt.data);
        } catch {
          return;
        }

        if (event.type === "delta") {
          updateAssistant((a) => ({ ...a, liveText: a.liveText + event.text }));
          return;
        }

        if (event.type === "tool_start") {
          updateAssistant((a) => {
            const blocks: AssistantBlock[] = [...a.blocks];
            if (a.liveText) blocks.push({ type: "text", text: a.liveText });
            blocks.push({ type: "tool", name: event.name, input: event.input || null });
            return { ...a, blocks, liveText: "", tools: [...a.tools, { name: event.name, input: event.input || null }] };
          });
          return;
        }

        if (event.type === "tool_result") {
          return;
        }

        if (event.type === "pending") {
          setTimeline((prev) => [...prev, { kind: "pending", testname: event.testname, status: "open", output: undefined, ran: false }]);
          return;
        }

        if (event.type === "done") {
          if (event.sessionId) setSessionId(event.sessionId);
          const isError = event.status === "error";
          updateAssistant((a) => {
            let blocks = [...a.blocks];
            let finalSegment = a.liveText;
            if (isError && !finalSegment) finalSegment = `*(Erreur : ${event.error || "inconnue"})*`;
            if (finalSegment) {
              blocks.push({ type: "text", text: finalSegment });
            } else if (blocks.length === 0) {
              blocks.push({ type: "text", text: "*(Aucune réponse)*" });
            }
            return { ...a, blocks, liveText: "", done: true };
          });
          es.close();
          setIsStreaming(false);
          setTimeline((prev) => {
            persistChat(prev, event.sessionId || sessionId);
            return prev;
          });
        }
      };

      es.onerror = () => {
        updateAssistant((a) => {
          if (a.liveText) return { ...a, blocks: [...a.blocks, { type: "text", text: a.liveText }], liveText: "", done: true };
          if (a.blocks.length === 0) return { ...a, blocks: [{ type: "text", text: "*(Erreur de connexion)*" }], liveText: "", done: true };
          return { ...a, done: true };
        });
        es.close();
        setIsStreaming(false);
      };
    } catch (err) {
      updateAssistant((a) => ({ ...a, blocks: [{ type: "text", text: `*(Erreur : ${err instanceof Error ? err.message : String(err)})*` }], liveText: "", done: true }));
      setIsStreaming(false);
    }
  };

  const stopStreaming = () => {
    if (currentRunId.current) {
      apiFetch("/api/chat-stop/" + currentRunId.current, { method: "POST" }).catch(() => {});
    }
  };

  // ── Pending card actions ──

  const updatePending = (idx: number, updater: (item: PendingItem) => PendingItem) => {
    setTimeline((prev) => {
      const next = [...prev];
      next[idx] = updater(next[idx] as PendingItem);
      return next;
    });
  };

  const runPending = (idx: number, testname: string) => {
    updatePending(idx, (item) => ({ ...item, output: "" }));
    (async () => {
      const res = await apiFetch(`/api/pending/${encodeURIComponent(testname)}/run`, { method: "POST" });
      if (!res.ok) {
        updatePending(idx, (item) => ({ ...item, output: t("run_error") }));
        return;
      }
      const { runId } = await res.json();
      const es = new EventSource(apiStreamUrl(`/api/stream/${runId}`));
      es.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        if (ev.text) updatePending(idx, (item) => ({ ...item, output: (item.output || "") + ev.text }));
        if (ev.done) {
          es.close();
          updatePending(idx, (item) => ({ ...item, ran: true }));
        }
      };
    })();
  };

  const confirmPending = async (idx: number, testname: string) => {
    await apiFetch(`/api/pending/${encodeURIComponent(testname)}/confirm`, { method: "POST" });
    updatePending(idx, (item) => ({ ...item, status: "confirmed" }));
  };

  const discardPending = async (idx: number, testname: string) => {
    await apiFetch(`/api/pending/${encodeURIComponent(testname)}/discard`, { method: "POST" });
    updatePending(idx, (item) => ({ ...item, status: "discarded" }));
  };

  // ── Save modal ──

  const openSaveModal = () => setSaveModal({ filename: "", error: null, saving: false });
  const closeSaveModal = () => setSaveModal(null);
  const doSave = async () => {
    if (!saveModal) return;
    const name = saveModal.filename.trim();
    if (!name) return;
    const filename = name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
    setSaveModal((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
    const messages = timeline
      .filter((item): item is UserItem | AssistantItem => item.kind !== "pending")
      .map((item) =>
        item.kind === "user"
          ? { role: "user", content: item.text, images: item.images.length > 0 ? item.images : undefined }
          : { role: "assistant", content: (item.blocks || []).filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""), tools: item.tools, blocks: item.blocks },
      );
    try {
      const res = await apiFetch("/api/chat-save", { method: "POST", body: JSON.stringify({ filename, messages }) });
      if (!res.ok) throw new Error(t("save_error_server") + " " + res.status);
      closeSaveModal();
    } catch (err) {
      setSaveModal((prev) => (prev ? { ...prev, saving: false, error: err instanceof Error ? err.message : String(err) } : prev));
    }
  };

  const hasContent = timeline.length > 0;
  const sendDisabled = isStreaming || (!inputValue.trim() && pendingImages.length === 0);

  return (
    <div className="chat-layout">
      <div className="chat-header">
        <div className="chat-header-info">
          <h1 className="chat-title">{t("chat_page_title")}</h1>
          <span className="chat-scope">{t("chat_scope")}</span>
        </div>
        <div className="chat-header-actions">
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
                  <AssistantContent item={item} />
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
