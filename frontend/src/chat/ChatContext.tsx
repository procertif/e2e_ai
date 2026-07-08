import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { apiFetch, apiStreamUrl } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useSelectedEnvironment } from "../hooks/useSelectedEnvironment";
import type { ToolInput } from "../utils/toolPills";
import type { Environment } from "../types";

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
Tu dois toujours générer ce json quand tu génères un test. Le json doit être dans /app/data/actionTest, inspire-toi du format des fichiers déjà existants dans ce dossier.
La spec (.md) et l'historique de conversation (promptTest) sont générés automatiquement par le serveur, tu n'as pas à t'en occuper.
`;

export interface PendingImage {
  data: string;
  media_type: string;
  name: string;
}

export interface ToolCall {
  name: string;
  input: ToolInput;
}

export type AssistantBlock = { type: "tool"; name: string; input: ToolInput } | { type: "text"; text: string };

export interface UserItem {
  kind: "user";
  text: string;
  images: { data: string; media_type: string }[];
}

export interface AssistantItem {
  kind: "assistant";
  blocks: AssistantBlock[];
  liveText: string;
  tools: ToolCall[];
  done: boolean;
}

export interface PendingItem {
  kind: "pending";
  testname: string;
  status: "open" | "confirmed" | "discarded";
  output?: string;
  ran: boolean;
}

export type TimelineItem = UserItem | AssistantItem | PendingItem;

export interface SaveModalState {
  filename: string;
  error: string | null;
  saving: boolean;
}

interface ChatContextValue {
  timeline: TimelineItem[];
  isStreaming: boolean;
  inputValue: string;
  setInputValue: (v: string) => void;
  pendingImages: PendingImage[];
  setPendingImages: React.Dispatch<React.SetStateAction<PendingImage[]>>;
  instructions: string;
  instructionsOpen: boolean;
  setInstructionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  saveModal: SaveModalState | null;
  setSaveModal: React.Dispatch<React.SetStateAction<SaveModalState | null>>;
  messagesRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  handleInstructionsChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  addFiles: (fileList: FileList | null) => void;
  handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  handleInputKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  resetChat: () => void;
  sendMessage: () => Promise<void>;
  stopStreaming: () => void;
  runPending: (idx: number, testname: string) => void;
  confirmPending: (idx: number, testname: string) => Promise<void>;
  discardPending: (idx: number, testname: string) => Promise<void>;
  openSaveModal: () => void;
  closeSaveModal: () => void;
  doSave: () => Promise<void>;
  hasContent: boolean;
  sendDisabled: boolean;
  environments: Environment[];
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  selectedEnvironment: Environment | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { t, ready } = useI18n();
  const { environments, selectedId, setSelectedId, selectedEnvironment } = useSelectedEnvironment();
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
  }, [ready]);

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

  // Streaming responses arrive over minutes — persist progressively (not just
  // on completion) so a tab switch mid-response never loses the exchange.
  useEffect(() => {
    if (timeline.length === 0) return;
    persistChat(timeline, sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, sessionId]);

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
        body: JSON.stringify({
          message: text,
          images: imagesToSend.length > 0 ? imagesToSend : null,
          sessionId,
          instructions: instructions.trim() || null,
          environmentId: selectedEnvironment?.id,
          environmentName: selectedEnvironment?.name,
          environmentUrl: selectedEnvironment?.url,
          environmentComment: selectedEnvironment?.comment,
        }),
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
      const res = await apiFetch(`/api/pending/${encodeURIComponent(testname)}/run`, {
        method: "POST",
        body: JSON.stringify({ baseUrl: selectedEnvironment?.url }),
      });
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
  const sendDisabled = isStreaming || (!inputValue.trim() && pendingImages.length === 0) || selectedId == null;

  const value: ChatContextValue = {
    timeline,
    isStreaming,
    inputValue,
    setInputValue,
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
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
