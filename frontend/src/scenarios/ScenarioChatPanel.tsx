import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch, apiStreamUrl } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { useAiQueue } from "../ai/AiQueueContext";
import { waitForTaskRunId, cancelQueuedTask } from "../ai/aiQueueClient";
import { toolPillClass } from "../utils/toolPills";
import { toolLabel, findSelectorMatches } from "../utils/toolNarration";
import { useEntityTitles } from "../utils/useEntityTitles";
import { useStickyScroll } from "../utils/useStickyScroll";

interface ChatBlock {
  type: "text" | "tool" | "image";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown> | null;
  result?: string;
  media_type?: string;
  data?: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  blocks: ChatBlock[];
}

// Sibling of CorrectionChatPanel, scoped to one scenario's expected-result
// spec. Same SSE machinery; the scenario's spec shown in the middle panel
// refreshes through onUpdate whenever a run finishes (WriteScenarioSpec may
// have rewritten it).
function consumeStream(
  runId: string,
  setLiveBlocks: Dispatch<SetStateAction<ChatBlock[] | null>>,
  onDone: (status: string, error?: string) => void,
) {
  const es = new EventSource(apiStreamUrl(`/api/chat-stream/${runId}`));
  let text = "";
  es.onmessage = (evt) => {
    let event: any;
    try {
      event = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (event.type === "delta") {
      text += event.text;
      setLiveBlocks((blocks) => {
        const next = [...(blocks || [])];
        if (next.length > 0 && next[next.length - 1].type === "text") next[next.length - 1] = { type: "text", text };
        else next.push({ type: "text", text });
        return next;
      });
    } else if (event.type === "tool_start") {
      text = "";
      setLiveBlocks((blocks) => [...(blocks || []), { type: "tool", id: event.id, name: event.name, input: event.input || null }]);
    } else if (event.type === "tool_result") {
      setLiveBlocks((blocks) => (blocks || []).map((b) => (b.type === "tool" && b.id === event.tool_use_id ? { ...b, result: event.content } : b)));
    } else if (event.type === "done") {
      es.close();
      onDone(event.status, event.error);
    }
  };
  es.onerror = () => {
    es.close();
    onDone("error");
  };
  return es;
}

function rawToTurns(messages: unknown[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const msg of messages as any[]) {
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
    const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content ?? "") }];
    if (content.length > 0 && content.every((b: any) => b?.type === "tool_result")) {
      const last = turns[turns.length - 1];
      if (last?.role === "assistant") {
        for (const rb of content) {
          const block = last.blocks.find((b) => b.type === "tool" && b.id === rb.tool_use_id);
          if (block && typeof rb.content === "string") block.result = rb.content;
        }
      }
      continue;
    }
    const blocks: ChatBlock[] = [];
    for (const b of content) {
      if (b?.type === "text" && b.text) blocks.push({ type: "text", text: b.text });
      else if (b?.type === "tool_use") blocks.push({ type: "tool", id: b.id, name: b.name, input: b.input || null });
      else if (b?.type === "image") blocks.push({ type: "text", text: "[image]" });
    }
    if (blocks.length > 0) turns.push({ role: msg.role, blocks });
  }
  return turns;
}

function TurnBlocks({
  blocks,
  live,
  titles,
}: {
  blocks: ChatBlock[];
  live: boolean;
  titles: ReturnType<typeof useEntityTitles>;
}) {
  return (
    <>
      {blocks.map((b, j) => {
        const isLast = j === blocks.length - 1;
        if (b.type === "tool") {
          const n = (b.name || "").toLowerCase();
          const matches = n === "findselector" ? findSelectorMatches(b.result) : [];
          return (
            <div className="tool-row" key={j}>
              <span className={`tool-pill tool-pill--${toolPillClass(b.name || "")}`} title={JSON.stringify(b.input, null, 2)}>
                {live && isLast && <span className="spinner-border spinner-xs tool-pill-spinner" role="status" aria-hidden="true" />}
                {toolLabel(b.name || "", b.input, titles)}
              </span>
              {matches.length > 0 && (
                <div className="tool-matches">
                  {matches.map((m, i) => (
                    <div className="tool-match-row" key={i}>
                      {m.file} — {m.lines.length === 1 ? `ligne ${m.lines[0]}` : `lignes ${m.lines.join(", ")}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }
        if (b.type === "image") {
          return <img className="correction-chat-image" src={`data:${b.media_type};base64,${b.data}`} key={j} alt="" />;
        }
        return <p key={j}>{b.text}</p>;
      })}
    </>
  );
}

export default function ScenarioChatPanel({
  testname,
  environmentId,
  onUpdate,
}: {
  testname: string;
  environmentId: number | null;
  onUpdate?: () => void;
}) {
  const { t } = useI18n();
  const { findTask } = useAiQueue();
  const titles = useEntityTitles();
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const [liveBlocks, setLiveBlocks] = useState<ChatBlock[] | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useStickyScroll<HTMLDivElement>([turns, liveBlocks, queuePosition], undefined, testname);
  const watchedRunId = useRef<string | null>(null);
  const activeStream = useRef<EventSource | null>(null);
  const cancelledWait = useRef(false);
  const queuedTaskId = useRef<number | null>(null);

  const sending = liveBlocks !== null || queuePosition !== null;

  const loadHistory = async () => {
    const res = await apiFetch("/api/scenarios/" + encodeURIComponent(testname));
    if (res.ok) {
      const data = await res.json();
      setTurns(rawToTurns(data.chatMessages || []));
    }
  };

  const closeStream = () => {
    activeStream.current?.close();
    activeStream.current = null;
    watchedRunId.current = null;
  };

  useEffect(() => {
    closeStream();
    setTurns(null);
    setLiveBlocks(null);
    setQueuePosition(null);
    queuedTaskId.current = null;
    loadHistory();
    return closeStream;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testname]);

  const attachToRun = (runId: string) => {
    if (watchedRunId.current === runId) return;
    closeStream();
    watchedRunId.current = runId;
    queuedTaskId.current = null;
    setQueuePosition(null);
    setLiveBlocks([]);
    setError(null);
    activeStream.current = consumeStream(runId, setLiveBlocks, (status, err) => {
      if (status === "error" && err) setError(err);
      setLiveBlocks(null);
      watchedRunId.current = null;
      activeStream.current = null;
      loadHistory();
      onUpdate?.();
    });
  };

  // Reattach to whatever's active for this scenario on every queue poll —
  // a run already in flight when this component (re)mounts included.
  const activeTask = findTask("scenario", testname);
  useEffect(() => {
    if (!activeTask) return;
    if (activeTask.status === "running" && activeTask.runId) attachToRun(activeTask.runId);
    else if (activeTask.status === "queued") setQueuePosition(activeTask.position ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTask?.id, activeTask?.status, activeTask?.runId, activeTask?.position]);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setError(null);
    cancelledWait.current = false;
    setTurns((prev) => [...(prev || []), { role: "user", blocks: [{ type: "text", text: message }] }]);
    try {
      const res = await apiFetch(`/api/scenarios/${encodeURIComponent(testname)}/chat`, {
        method: "POST",
        body: JSON.stringify({ message, environmentId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { taskId, status, runId: immediateRunId } = await res.json();
      if (status === "queued") {
        queuedTaskId.current = taskId;
        setQueuePosition(0);
        const runId = await waitForTaskRunId(taskId, () => cancelledWait.current);
        queuedTaskId.current = null;
        if (runId) attachToRun(runId);
        else setQueuePosition(null);
      } else if (immediateRunId) {
        attachToRun(immediateRunId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stop = () => {
    cancelledWait.current = true;
    if (watchedRunId.current) {
      apiFetch(`/api/chat-stop/${watchedRunId.current}`, { method: "POST" }).catch(() => {});
      return;
    }
    const taskId = queuedTaskId.current ?? (activeTask?.status === "queued" ? activeTask.id : null);
    if (taskId != null) cancelQueuedTask(taskId).catch(() => {});
    queuedTaskId.current = null;
    setQueuePosition(null);
  };

  return (
    <div className="correction-chat">
      <div className="correction-chat-messages" ref={messagesRef}>
        {turns === null && <p className="correction-chat-hint">{t("loading")}</p>}
        {turns?.length === 0 && !liveBlocks && queuePosition === null && <p className="correction-chat-hint">{t("scenario_chat_empty")}</p>}
        {turns?.map((turn, i) => (
          <div className={"correction-chat-turn correction-chat-turn--" + turn.role} key={i}>
            <TurnBlocks blocks={turn.blocks} live={false} titles={titles} />
          </div>
        ))}
        {queuePosition !== null && (
          <div className="chat-queued-hint">
            <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />
            {t("chat_queued_hint").replace("{n}", String(queuePosition + 1))}
          </div>
        )}
        {liveBlocks && (
          <div className="correction-chat-turn correction-chat-turn--assistant">
            <TurnBlocks blocks={liveBlocks} live titles={titles} />
            {(liveBlocks.length === 0 || liveBlocks[liveBlocks.length - 1].type !== "tool") && (
              <span className="spinner-border spinner-xs" role="status" aria-hidden="true" />
            )}
          </div>
        )}
        {error && <p className="versioning-error">{error}</p>}
      </div>
      <div className="correction-chat-input-row">
        <textarea
          className="form-control"
          rows={2}
          placeholder={t("scenario_chat_placeholder")}
          value={input}
          disabled={sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {sending ? (
          <button className="btn btn-outline-danger btn-sm" onClick={stop}>
            {t("btn_stop_title")}
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" disabled={!input.trim()} onClick={send}>
            {t("btn_send_title")}
          </button>
        )}
      </div>
    </div>
  );
}
