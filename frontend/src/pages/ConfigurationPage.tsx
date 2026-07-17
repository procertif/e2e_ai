import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments, faWrench, faListOl, faWandMagicSparkles, faRotateLeft, faDownload, faUpload, faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import "../styles/configuration.css";

interface PromptEntry {
  value: string | null;
  default: string;
}

type PromptKey = "classic" | "correction" | "creation" | "scenario";
type PromptsConfig = Record<PromptKey, PromptEntry>;

const PROMPT_KEYS: PromptKey[] = ["classic", "correction", "creation", "scenario"];

const MENU = [
  { key: "classic" as PromptKey, i18nKey: "config_prompt_classic_title", icon: faComments },
  { key: "correction" as PromptKey, i18nKey: "config_prompt_correction_title", icon: faWrench },
  { key: "creation" as PromptKey, i18nKey: "config_prompt_creation_title", icon: faWandMagicSparkles },
  { key: "scenario" as PromptKey, i18nKey: "config_prompt_scenario_title", icon: faListOl },
];

export default function ConfigurationPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PromptsConfig | null>(null);
  const [drafts, setDrafts] = useState<Record<PromptKey, string>>({ classic: "", correction: "", creation: "", scenario: "" });
  const [active, setActive] = useState<PromptKey>("classic");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyConfig = (data: PromptsConfig) => {
    setConfig(data);
    setDrafts({
      classic: data.classic.value ?? data.classic.default,
      correction: data.correction.value ?? data.correction.default,
      creation: data.creation.value ?? data.creation.default,
      scenario: data.scenario.value ?? data.scenario.default,
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/config/prompts");
        if (!res.ok) throw new Error();
        applyConfig(await res.json());
      } catch {
        setError(t("config_load_error"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDefault = config ? drafts[active].trim() === config[active].default.trim() : true;
  const isDirty = config
    ? PROMPT_KEYS.some((key) => drafts[key].trim() !== (config[key].value ?? config[key].default).trim())
    : false;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch("/api/config/prompts", {
        method: "PUT",
        body: JSON.stringify(drafts),
      });
      if (!res.ok) throw new Error();
      applyConfig(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t("config_save_error"));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    if (!config) return;
    setDrafts((d) => ({ ...d, [active]: config[active].default }));
  };

  const exportTxt = () => {
    const blob = new Blob([drafts[active]], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prompt_${active}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTxt = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDrafts((d) => ({ ...d, [active]: reader.result as string }));
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("config_page_title")}</h1>
        <span className="badge-env">CONFIG</span>
      </div>

      <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
        {!config && !error && (
          <div className="config-loading">
            <span className="spinner-border spinner-xs" role="status" aria-hidden="true" /> {t("config_loading")}
          </div>
        )}
        {error && !config && <div className="environments-empty">{error}</div>}

        {config && (
          <div className="config-layout">
            <nav className="config-menu">
              {MENU.map((item) => (
                <button
                  key={item.key}
                  className={"config-menu-item" + (active === item.key ? " is-active" : "")}
                  onClick={() => setActive(item.key)}
                >
                  <FontAwesomeIcon icon={item.icon} fixedWidth style={{ fontSize: 13 }} />
                  <span>{t(item.i18nKey)}</span>
                  {config[item.key].value !== null && <span className="config-menu-dot" title={t("config_badge_custom")} />}
                </button>
              ))}
            </nav>

            <div className="config-editor-pane">
              <div className="config-editor-toolbar">
                <div className="config-editor-title">
                  <h2>{t(MENU.find((m) => m.key === active)!.i18nKey)}</h2>
                  {isDefault ? (
                    <span className="config-badge config-badge--default">{t("config_badge_default")}</span>
                  ) : (
                    <span className="config-badge config-badge--custom">{t("config_badge_custom")}</span>
                  )}
                </div>
                <div className="config-editor-actions">
                  <button className="btn btn-outline-secondary btn-sm" title={t("config_btn_import_title")} onClick={() => fileInputRef.current?.click()}>
                    <FontAwesomeIcon icon={faUpload} style={{ fontSize: 11 }} /> {t("config_btn_import")}
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" title={t("config_btn_export_title")} onClick={exportTxt}>
                    <FontAwesomeIcon icon={faDownload} style={{ fontSize: 11 }} /> {t("config_btn_export")}
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" disabled={isDefault} onClick={resetToDefault}>
                    <FontAwesomeIcon icon={faRotateLeft} style={{ fontSize: 11 }} /> {t("config_btn_reset")}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) importTxt(file);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              {active === "correction" && <p className="config-prompt-hint">{t("config_correction_placeholder_hint")}</p>}
              {active === "creation" && <p className="config-prompt-hint">{t("config_correction_placeholder_hint")}</p>}
              {active === "scenario" && <p className="config-prompt-hint">{t("config_scenario_placeholder_hint")}</p>}

              <textarea
                className="config-prompt-textarea"
                value={drafts[active]}
                spellCheck={false}
                onChange={(e) => setDrafts((d) => ({ ...d, [active]: e.target.value }))}
              />

              <div className="config-actions">
                <button className="btn btn-primary btn-sm" disabled={saving || !isDirty} onClick={save}>
                  <FontAwesomeIcon icon={faFloppyDisk} style={{ fontSize: 11 }} /> {saving ? t("config_btn_saving") : t("config_btn_save")}
                </button>
                {saved && <span className="config-saved">{t("config_saved")}</span>}
                {error && <span className="config-error">{error}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
