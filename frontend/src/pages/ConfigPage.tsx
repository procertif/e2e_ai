import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import "../styles/config.css";

interface KnownVar {
  key: string;
  labelKey: string;
  descKey: string;
  warning?: boolean;
  secret?: boolean;
  type?: "select";
  optKeys?: [string, string][];
}

const KNOWN: KnownVar[] = [
  { key: "BASE_URL", labelKey: "known_var_base_url_label", descKey: "known_var_base_url_desc" },
  { key: "TEST_OTP", labelKey: "known_var_otp_label", descKey: "known_var_otp_desc" },
  { key: "PORT", labelKey: "known_var_port_label", descKey: "known_var_port_desc", warning: true },
  { key: "ANTHROPIC_CLIENT_ID", labelKey: "known_var_anthropic_id_label", descKey: "known_var_anthropic_id_desc", secret: true },
  { key: "ANTHROPIC_MODEL", labelKey: "known_var_anthropic_model_label", descKey: "known_var_anthropic_model_desc" },
  {
    key: "LANG",
    labelKey: "known_var_lang_label",
    descKey: "known_var_lang_desc",
    type: "select",
    optKeys: [["en", "known_var_lang_opt_en"], ["fr", "known_var_lang_opt_fr"]],
  },
];

interface Status {
  type: "success" | "error";
  text: string;
}

export default function ConfigPage() {
  const { t, ready, lang } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const res = await apiFetch("/api/config");
      const env = await res.json();
      const initial: Record<string, string> = {};
      for (const v of KNOWN) {
        initial[v.key] = env[v.key] ?? (v.type === "select" ? "en" : "");
      }
      setValues(initial);
    })();
  }, [ready]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const data: Record<string, string> = {};
    for (const v of KNOWN) {
      const val = (values[v.key] ?? "").toString().trim();
      if (val !== "") data[v.key] = val;
    }
    try {
      const res = await apiFetch("/api/config", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setStatus({ type: "success", text: t("config_saved") });
        if (values.LANG !== undefined && values.LANG !== lang) {
          setTimeout(() => window.location.reload(), 800);
        }
      } else {
        setStatus({ type: "error", text: t("config_save_error") });
      }
    } catch {
      setStatus({ type: "error", text: t("config_network_error") });
    }
    setSaving(false);
    setTimeout(() => setStatus(null), 3000);
  };

  return (
    <>
      <div className="app-topbar">
        <h1>{t("config_page_title")}</h1>
        <span className="badge-env">.ENV</span>
      </div>

      <div className="app-content" style={{ overflowY: "auto", display: "block" }}>
        <div className="config-section">
          <div className="config-section-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#6c757d" viewBox="0 0 16 16">
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.892 3.433-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.892-1.64-.901-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52z" />
            </svg>
            <h2 className="config-section-title">{t("config_section_title")}</h2>
          </div>

          <div className="config-section-body" id="known-vars">
            {KNOWN.map((v) => (
              <div className="config-row" key={v.key}>
                <p className="config-label">
                  {t(v.labelKey)}
                  {v.warning && <span className="badge-warning">{t("restart_required_badge")}</span>}
                </p>
                <p className="config-desc">{t(v.descKey)}</p>
                {v.type === "select" ? (
                  <select
                    className="config-input"
                    value={values[v.key] ?? "en"}
                    onChange={(e) => handleChange(v.key, e.target.value)}
                  >
                    {v.optKeys!.map(([optVal, optKey]) => (
                      <option key={optVal} value={optVal}>
                        {t(optKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={v.secret ? "password" : "text"}
                    className="config-input"
                    autoComplete="off"
                    value={values[v.key] ?? ""}
                    onChange={(e) => handleChange(v.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="config-footer">
            <button className="btn btn-primary btn-sm" type="button" onClick={handleSave} disabled={saving}>
              {t("btn_save_config")}
            </button>
            <span className={"save-status" + (status ? " " + status.type : "")}>{status?.text || ""}</span>
          </div>
        </div>
      </div>
    </>
  );
}
