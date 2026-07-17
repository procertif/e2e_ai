import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFolder } from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "../i18n/I18nContext";
import { environmentColorHex } from "../utils/environmentColors";
import { useEnvironment } from "../environment/EnvironmentContext";
import { RepoUpdateBanner, RepoUpdateIcon } from "../environment/RepoUpdateBanner";
import CreationsView from "../creations/CreationsView";
import CorrectionsView from "../corrections/CorrectionsView";
import TestsListView from "../tests/TestsListView";
import { AiQueuePausedBanner } from "../ai/AiQueuePausedBanner";
import "../styles/groups.css";
import "../styles/environments.css";
import "../styles/corrections.css";

export default function TestsPage() {
  const { t } = useI18n();
  const { environments, environmentsLoaded, selectedId, setSelectedId, selectedEnvironment } = useEnvironment();
  // Page-level view: test list (which embeds the execution queue), test
  // creation (landing), or corrections. Deep-linkable via ?tab= (the
  // Campaigns page's "corriger" links land on ?tab=corrections&filename=…);
  // the retired "queue" value falls back to the list, which hosts the queue
  // now.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [topTab, setTopTab] = useState<"list" | "creation" | "corrections">(
    tabParam === "list" || tabParam === "queue" ? "list" : tabParam === "corrections" ? "corrections" : "creation",
  );
  const switchTopTab = (tab: "list" | "creation" | "corrections") => {
    setTopTab(tab);
    // The filename param belongs to the corrections view — don't carry it
    // over to the other tabs.
    setSearchParams(tab === "creation" ? {} : { tab });
  };

  if (environmentsLoaded && environments.length === 0) {
    return (
      <div className="app-content">
        <div className="groups-tab-empty no-environment-empty">
          <FontAwesomeIcon icon={faFolder} style={{ fontSize: 28, opacity: 0.25 }} />
          <p>{t("no_environment_title")}</p>
          <p>{t("no_environment_message")}</p>
          <a href="/environments">{t("no_environment_cta")}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="app-content">
      <AiQueuePausedBanner />
      <RepoUpdateBanner environment={selectedEnvironment} />
      <div className="target-environment-bar">
        <span className="environment-color-dot" style={{ background: selectedEnvironment ? environmentColorHex(selectedEnvironment.color) : "#ced4da" }} />
        <label className="target-environment-label" htmlFor="target-environment-select">
          {t("target_environment_label")}
        </label>
        <select
          id="target-environment-select"
          className="form-select form-select-sm target-environment-select"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <RepoUpdateIcon environment={selectedEnvironment} />
      </div>
      <div className="tests-top-tabs correction-tabs">
        <button className={"correction-tab" + (topTab === "list" ? " is-active" : "")} onClick={() => switchTopTab("list")}>
          {t("tests_tab_list")}
        </button>
        <button className={"correction-tab" + (topTab === "creation" ? " is-active" : "")} onClick={() => switchTopTab("creation")}>
          {t("tests_tab_creation")}
        </button>
        <button className={"correction-tab" + (topTab === "corrections" ? " is-active" : "")} onClick={() => switchTopTab("corrections")}>
          {t("tests_tab_corrections")}
        </button>
      </div>
      {topTab === "list" && <TestsListView />}
      {topTab === "creation" && <CreationsView />}
      {topTab === "corrections" && <CorrectionsView />}
    </div>
  );
}
