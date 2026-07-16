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
import { useEnvironment } from "../environment/EnvironmentContext";
import { useAiQueue } from "../ai/AiQueueContext";
import { waitForTaskRunId, cancelQueuedTask } from "../ai/aiQueueClient";
import type { ToolInput } from "../utils/toolPills";
import type { ConversationSummary, Environment } from "../types";

const CHAT_STORAGE_KEY = "procertif_chat";
const INSTRUCTIONS_STORAGE_KEY = "procertif_instructions";

const DEFAULT_INSTRUCTIONS = `Tu génères et corriges des tests end-to-end Playwright pour l'application Procertif. Suis ces 4 étapes dans l'ordre, sans en sauter aucune.

## 1. Plan — avant d'écrire le moindre code

Annonce d'abord à l'utilisateur, en français et en langage simple (aucun jargon technique, aucun sélecteur CSS, aucun nom de fonction), la liste numérotée des étapes que le test va réaliser. Par exemple :
1. Aller sur la page /certifications en vue liste
2. Cliquer sur "Créer un badge"
3. Remplir le titre du badge
4. Enregistrer et vérifier que le badge apparaît dans la liste

Cette liste doit correspondre exactement au déroulé du test que tu vas écrire ensuite — elle permet à l'utilisateur de valider l'intention avant que tu passes à l'implémentation. N'écris pas de code Playwright dans ce message.

## 2. Implémentation

N'ouvre PAS et ne t'inspire PAS des autres fichiers .spec.ts déjà présents dans data/versioned/tests/ — tu n'as de toute façon pas d'outil pour les lire. Tout ce dont tu as besoin pour écrire un test conforme est décrit ci-dessous — génère-le uniquement à partir de ces règles et de ta connaissance de Playwright, pas en copiant un test existant.

Si le test a besoin d'une valeur qui dépend de l'environnement (token, OTP, identifiants…), appelle d'abord l'outil ListEnvironmentVariables pour voir quelles clés existent sur l'environnement cible de cette conversation, avant d'écrire le code qui les utilise.

Le code source de l'application testée est présent en local dans data/testedRepositories/<branche>/ où <branche> est la branche liée à l'environnement cible de cette conversation (configurée et récupérée sur la page Environnements) — pas forcément disponible pour tous les environnements. Pour trouver le bon sélecteur (texte exact d'un bouton, d'un label, d'une route…) sans deviner à l'aveugle, utilise l'outil FindSelector, qui cherche directement dans ce dossier. Tu peux aussi lire un fichier entier de ce code avec ReadDataFile (ex: path: "data/testedRepositories/<branche>/frontend/src/...") une fois que FindSelector t'a indiqué où chercher. Si FindSelector répond que ce n'est pas disponible pour cet environnement, retombe sur les captures d'écran (ReadDataFile sur data/screenshots/...) pour déduire le texte visible à l'écran.

Le test s'appelle <nom_du_test> (snake_case, sans accents) et va dans data/versioned/tests/<nom_du_test>.spec.ts. Écris-le avec l'outil WriteTestFile (kind: "spec", testname: "<nom_du_test>", mode: "create", content: <le fichier complet>) — le fichier est mis en attente de confirmation par l'utilisateur, il n'est pas actif immédiatement. Structure obligatoire du contenu :

\`\`\`typescript
import { test, expect } from "@playwright/test";
import { getScreenshotDir, createShot, getEnvironmentBaseUrl } from "../../../src/testUtils";
// N'importe getEnvironmentVariable que si le test a besoin d'une variable d'environnement :
// import { getEnvironmentVariable } from "../../../src/testUtils";

const SCREENSHOTS_DIR = getScreenshotDir("<nom_du_test>");
const BASE_URL = getEnvironmentBaseUrl();
// Une const par variable d'environnement utilisée, seulement si le test en a besoin :
// const VALIDATION_TOKEN = getEnvironmentVariable("validation_token");

test.use({
  launchOptions: { args: ["--lang=fr-FR"] },
  locale: "fr-FR",
  viewport: { width: 1920, height: 1080 },
});

const shot = createShot(SCREENSHOTS_DIR);

test("<nom_du_test>", async ({ page }) => {
  test.setTimeout(180_000);

  // ACTION: <description courte en français>
  await test.step("[1/N] <description>", async () => {
    await page.goto(\`\${BASE_URL}/chemin\`, { waitUntil: "domcontentloaded" });
    await shot(page, 1, "label-court");
  });

  // ACTION: <description courte en français>
  await test.step("[2/N] <description>", async () => {
    await page.getByRole("button", { name: "Texte du bouton" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Texte du bouton" }).click();
    await shot(page, 2, "label-court");
  });

  // ... une étape par action, numérotée [i/N]
});
\`\`\`

Règles obligatoires :
- N n'est pas un espace réservé : remplace-le par le nombre total réel d'étapes une fois le test terminé (ex. [1/7], [2/7]…), et mets-le à jour si tu ajoutes ou retires une étape en itérant.
- \`const BASE_URL = getEnvironmentBaseUrl();\` — jamais d'URL écrite en dur.
- Toute valeur qui peut différer d'un environnement à l'autre (token de validation, code OTP, identifiants, feature flag…) DOIT passer par \`getEnvironmentVariable("clé")\` — jamais de valeur en dur dans le test. Si une variable dont tu as besoin n'existe pas encore sur l'environnement cible, dis-le à l'utilisateur (il doit l'ajouter sur la page Environnements) au lieu d'inventer une valeur.
- \`getScreenshotDir\` crée le dossier automatiquement — pas de mkdirSync.
- \`await shot(page, n, "label");\` après CHAQUE action, sans exception, avec n incrémenté à chaque appel (jamais de doublon ni de trou). Utilise \`createShot(SCREENSHOTS_DIR, 3)\` à la place si le test dépasse 99 étapes.
- Avant de cliquer ou saisir dans un élément, attends-le explicitement (\`.waitFor({ state: "visible", timeout: 10_000 })\`) plutôt que de compter sur l'attente implicite de Playwright.
- Sélecteurs : privilégie \`getByRole\`, \`getByText\`, \`getByPlaceholder\`, \`getByLabel\` (accessibles, stables) ; utilise \`frameLocator\` pour tout contenu dans une iframe (éditeurs riches type TinyMCE, modales d'édition…). Évite les sélecteurs CSS fragiles (classes générées, nth-child) sauf en dernier recours.
- Playwright natif uniquement, jamais de librairie tierce d'automatisation.
- Regroupe TOUJOURS les appels d'outils indépendants dans le même bloc pour les exécuter en parallèle — ne les appelle jamais séquentiellement si leurs entrées ne dépendent pas les unes des autres.
- Écris aussi, avec WriteTestFile (kind: "actions", testname: "<nom_du_test>", mode: "create"), data/actionTest/<nom_du_test>.json avec exactement cette forme (un objet par étape, dans le même ordre que les test.step) :

\`\`\`json
{
  "test": "<nom_du_test>",
  "file": "<nom_du_test>.spec.ts",
  "description": "<résumé en une phrase du scénario>",
  "actions": [
    { "index": 1, "action": "navigation", "description": "<description courte en français>", "selector": null, "screenshot": "01-label-court.png" },
    { "index": 2, "action": "clic", "description": "<description courte en français>", "selector": "<sélecteur ou description du sélecteur>", "screenshot": "02-label-court.png" }
  ]
}
\`\`\`
  "action" vaut "navigation", "clic", "saisie", ou "assertion" selon la nature de l'étape. "selector" est null pour une navigation, sinon le sélecteur (ou sa description) utilisé. "screenshot" est le nom de fichier exact généré par \`shot()\` pour cette étape.
- La spec Gherkin (.md) et l'historique de prompt (promptTest) sont générés automatiquement par le serveur, tu n'as pas à t'en occuper.
- Pour corriger un fichier déjà écrit, utilise WriteTestFile avec mode: "edit" (old_string/new_string) plutôt que de réécrire tout le contenu avec mode: "create".

## 3. Exécution et itération

1. Lance le test avec l'outil RunTest (testname: "<nom_du_test>", pending: true — le fichier est en attente de confirmation, pas encore actif dans data/versioned/tests/).
2. S'il échoue, lis avec ReadDataFile le screenshot de l'étape où ça bloque (path: "data/screenshots/<nom_du_test>/<fichier>.png"), et si besoin celui de l'étape précédente pour voir ce qui a changé entre les deux, afin de comprendre la cause exacte avant de corriger.
3. Corrige le test avec WriteTestFile, relance avec RunTest, recommence.

## 4. Si ça bloque encore après 3 tentatives

Si le test échoue toujours après 3 exécutions (même étape bloquante ou échecs différents sans progrès clair) :
- Arrête de relancer à l'aveugle.
- Lis avec ReadDataFile le screenshot de l'étape qui bloque et, si utile, celui de la dernière étape réussie juste avant — ces images s'affichent directement dans la conversation, l'utilisateur les voit.
- Explique en langage simple ce qui semble bloquer (élément introuvable, texte différent de ce qui était attendu, timing, page inattendue…).
- Demande à l'utilisateur comment il veut continuer plutôt que de continuer à deviner.

## Outils disponibles

Tu n'as accès qu'à 6 outils, chacun strictement limité à ce projet de tests e2e : WriteTestFile, ReadDataFile, ListEnvironmentVariables, RunTest, FindSelector, WebFetch. Aucun autre accès fichier ou shell n'existe — pas de chemin arbitraire, pas de commande arbitraire.
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

export type AssistantBlock =
  | { type: "tool"; id: string; name: string; input: ToolInput; result?: string }
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string };

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

// Converts the raw Anthropic-shaped messages persisted in chat_logs (see
// backend/ia.js persistChatLog) back into TimelineItem[] for display when
// resuming a past conversation. Tool-result turns (role "user", every block
// a tool_result) are request plumbing, not a visible message, so they're
// skipped. Images inside historical messages are redacted server-side to
// { type: "image", media_type } with no pixel data, so they can't be
// re-rendered — only the accompanying text survives.
function rawMessagesToTimeline(messages: unknown): TimelineItem[] {
  if (!Array.isArray(messages)) return [];
  const items: TimelineItem[] = [];
  for (const msg of messages as any[]) {
    if (msg?.role === "user") {
      if (typeof msg.content === "string") {
        items.push({ kind: "user", text: msg.content, images: [] });
        continue;
      }
      if (Array.isArray(msg.content)) {
        const isToolResult = msg.content.length > 0 && msg.content.every((b: any) => b?.type === "tool_result");
        if (isToolResult) {
          // The only place this text still exists on reload — attach it to
          // the matching tool_use block on the assistant item right before
          // it, then drop this message (it's not a real turn to display).
          const last = items[items.length - 1];
          if (last?.kind === "assistant") {
            for (const rb of msg.content) {
              const block = last.blocks.find((b) => b.type === "tool" && b.id === rb.tool_use_id) as
                | (AssistantBlock & { type: "tool" })
                | undefined;
              if (block && typeof rb.content === "string") block.result = rb.content;
            }
          }
          continue;
        }
        const textBlock = msg.content.find((b: any) => b?.type === "text");
        items.push({ kind: "user", text: textBlock?.text || "", images: [] });
      }
      continue;
    }
    if (msg?.role === "assistant" && Array.isArray(msg.content)) {
      const blocks: AssistantBlock[] = msg.content
        .filter((b: any) => b?.type === "text" || b?.type === "tool_use")
        .map((b: any) => (b.type === "text" ? { type: "text", text: b.text || "" } : { type: "tool", id: b.id, name: b.name, input: b.input }));
      const tools: ToolCall[] = blocks.filter((b): b is { type: "tool"; id: string; name: string; input: ToolInput } => b.type === "tool").map((b) => ({ name: b.name, input: b.input }));
      items.push({ kind: "assistant", blocks, liveText: "", tools, done: true });
    }
  }
  return items;
}

interface ChatContextValue {
  timeline: TimelineItem[];
  isStreaming: boolean;
  queuePosition: number | null;
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
  resetInstructions: () => void;
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
  sessionId: string | null;
  conversations: ConversationSummary[];
  loadConversation: (chatLogId: number) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { t, ready } = useI18n();
  const { environments, selectedId, setSelectedId, selectedEnvironment } = useEnvironment();
  const { tasks: aiQueueTasks } = useAiQueue();
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedTaskId, setQueuedTaskId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [instructions, setInstructions] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saveModal, setSaveModal] = useState<SaveModalState | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const queuePosition = queuedTaskId != null ? (aiQueueTasks.find((task) => task.id === queuedTaskId)?.position ?? null) : null;

  const currentRunId = useRef<string | null>(null);
  const cancelledSend = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const pendingSeedHistoryRef = useRef<unknown[] | null>(null);

  const refreshConversations = async () => {
    try {
      const res = await apiFetch("/api/conversations");
      if (res.ok) setConversations(await res.json());
    } catch {}
  };

  const loadConversation = async (chatLogId: number) => {
    try {
      const res = await apiFetch(`/api/chat-logs/${chatLogId}`);
      if (!res.ok) return;
      const data = await res.json();
      pendingSeedHistoryRef.current = Array.isArray(data.messages) ? data.messages : null;
      setTimeline(rawMessagesToTimeline(data.messages));
      setSessionId(data.runId || null);
      setPendingImages([]);
    } catch {}
  };

  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    refreshConversations();
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

  const resetInstructions = () => {
    setInstructions(DEFAULT_INSTRUCTIONS);
    localStorage.setItem(INSTRUCTIONS_STORAGE_KEY, DEFAULT_INSTRUCTIONS);
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
    pendingSeedHistoryRef.current = null;
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

    const seedHistory = pendingSeedHistoryRef.current;
    pendingSeedHistoryRef.current = null;
    cancelledSend.current = false;

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          images: imagesToSend.length > 0 ? imagesToSend : null,
          sessionId,
          instructions: instructions.trim() || null,
          environmentId: selectedEnvironment?.id,
          seedHistory: seedHistory || undefined,
        }),
      });
      if (!res.ok) throw new Error(t("save_error_server") + " " + res.status);
      const { taskId, status, runId: immediateRunId } = await res.json();

      let runId = immediateRunId;
      if (status === "queued") {
        setQueuedTaskId(taskId);
        runId = await waitForTaskRunId(taskId, () => cancelledSend.current);
        setQueuedTaskId(null);
        if (!runId) {
          // Only reachable via explicit cancellation (stopStreaming) — a
          // task that finishes between polls still resolves to a runId
          // first, waitForTaskRunId only gives up on user-cancel.
          updateAssistant((a) =>
            a.liveText || a.blocks.length > 0
              ? { ...a, blocks: a.liveText ? [...a.blocks, { type: "text", text: a.liveText }] : a.blocks, liveText: "", done: true }
              : { ...a, blocks: [{ type: "text", text: "*(Annulé)*" }], done: true }
          );
          setIsStreaming(false);
          return;
        }
      }
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
            blocks.push({ type: "tool", id: event.id, name: event.name, input: event.input || null });
            return { ...a, blocks, liveText: "", tools: [...a.tools, { name: event.name, input: event.input || null }] };
          });
          return;
        }

        if (event.type === "tool_output") {
          // Live console lines from a RunTest in progress — appended as they
          // arrive; the final tool_result below replaces the accumulation
          // with the definitive full output.
          updateAssistant((a) => {
            const blocks = a.blocks.map((b) => (b.type === "tool" && b.id === event.tool_use_id ? { ...b, result: (b.result || "") + event.text } : b));
            return { ...a, blocks };
          });
          return;
        }

        if (event.type === "tool_result") {
          updateAssistant((a) => {
            const blocks = a.blocks.map((b) => (b.type === "tool" && b.id === event.tool_use_id ? { ...b, result: event.content } : b));
            return { ...a, blocks };
          });
          return;
        }

        if (event.type === "tool_image") {
          updateAssistant((a) => {
            const blocks: AssistantBlock[] = [...a.blocks];
            if (a.liveText) blocks.push({ type: "text", text: a.liveText });
            blocks.push({ type: "image", media_type: event.media_type, data: event.data });
            return { ...a, blocks, liveText: "" };
          });
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
          refreshConversations();
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
    cancelledSend.current = true;
    if (currentRunId.current) {
      apiFetch("/api/chat-stop/" + currentRunId.current, { method: "POST" }).catch(() => {});
    } else if (queuedTaskId != null) {
      cancelQueuedTask(queuedTaskId).catch(() => {});
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
        body: JSON.stringify({ baseUrl: selectedEnvironment?.url, environmentId: selectedEnvironment?.id ?? null }),
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
    queuePosition,
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
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
