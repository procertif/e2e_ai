import { useAiQueue } from "./AiQueueContext";
import { useI18n } from "../i18n/I18nContext";

// Shown wherever AI-queue work surfaces (Conversation, Corrections) when the
// backend restarted with tasks still pending — the queue deliberately comes
// back up paused (see backend/aiQueue.js) and nothing runs until the user
// resumes it here.
export function AiQueuePausedBanner() {
  const { t } = useI18n();
  const { paused, tasks, resume } = useAiQueue();
  if (!paused) return null;
  return (
    <div className="ai-queue-paused-banner">
      <span>⏸ {t("ai_queue_paused_banner").replace("{n}", String(tasks.length))}</span>
      <button className="btn btn-warning btn-sm" onClick={resume}>
        {t("btn_resume_queue")}
      </button>
    </div>
  );
}
