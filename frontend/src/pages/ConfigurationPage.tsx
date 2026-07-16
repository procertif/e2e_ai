import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import "../styles/configuration.css";

interface PromptEntry {
  value: string | null;
  default: string;
}

interface PromptsConfig {
  classic: PromptEntry;
  correction: PromptEntry;
}

type PromptKey = "classic" | "correction";

const PROMPT_KEYS: PromptKey[] = ["classic", "correction"];

export default function ConfigurationPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PromptsConfig | null>(null);
  const [drafts, setDrafts] = useState<Record<PromptKey, string>>({ classic: "", correction: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/config/prompts");
        if (!res.ok) throw new Error();
        const data: PromptsConfig = await res.json();
        setConfig(data);
        setDrafts({
          classic: data.classic.value ?? data.classic.default,
          correction: data.correction.value ?? data.correction.default,
        });
      } catch {
        setError(t("config_load_error"));
      }
    })();
  }, []);

  if (error) {
    return (
      <>
        <div className="app-topbar">
          <h1>{t("config_page_title")}</h1>
        </div>
        <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
          <div className="environments-empty">{error}</div>
        </div>
      </>
    );
  }

  if (!config) {
    return (
      <>
        <div className="app-topbar">
          <h1>{t("config_page_title")}</h1>
        </div>
        <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
          <div className="config-loading">
            <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("config_loading")}
          </div>
        </div>
      </>
    );
  }

  const isDefault = (key: PromptKey) => drafts[key].trim() === config[key].default.trim();
  const isDirty = PROMPT_KEYS.some(
    (key) => drafts[key].trim() !== (config[key].value ?? config[key].default).trim(),
  );

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch("/api/config/prompts", {
        method: "PUT",
        body: JSON.stringify({ classic: drafts.classic, correction: drafts.correction }),
      });
      if (!res.ok) throw new Error();
      const data: PromptsConfig = await res.json();
      setConfig(data);
      setDrafts({
        classic: data.classic.value ?? data.classic.default,
        correction: data.correction.value ?? data.correction.default,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t("config_save_error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("config_page_title")}</h1>
        <span className="badge-env">CONFIG</span>
      </div>

      <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
        <p className="config-intro">{t("config_prompts_intro")}</p>

        {PROMPT_KEYS.map((key) => (
          <section className="config-prompt" key={key}>
            <div className="config-prompt-header">
              <h2>{t(key === "classic" ? "config_prompt_classic_title" : "config_prompt_correction_title")}</h2>
              {isDefault(key) ? (
                <span className="config-badge config-badge--default">{t("config_badge_default")}</span>
              ) : (
                <span className="config-badge config-badge--custom">{t("config_badge_custom")}</span>
              )}
              {!isDefault(key) && (
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setDrafts((d) => ({ ...d, [key]: config[key].default }))}
                >
                  {t("config_btn_reset")}
                </button>
              )}
            </div>
            {key === "correction" && <p className="config-prompt-hint">{t("config_correction_placeholder_hint")}</p>}
            <textarea
              className="config-prompt-textarea"
              value={drafts[key]}
              spellCheck={false}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
            />
          </section>
        ))}

        <div className="config-actions">
          <button className="btn btn-primary btn-sm" disabled={saving || !isDirty} onClick={save}>
            {saving ? t("config_btn_saving") : t("config_btn_save")}
          </button>
          {saved && <span className="config-saved">{t("config_saved")}</span>}
          {error && <span className="config-error">{error}</span>}
        </div>
      </div>
    </>
  );
}
