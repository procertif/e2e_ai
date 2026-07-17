import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useEnvironment } from "../environment/EnvironmentContext";
import { renderGherkin } from "../utils/format";
import ScenarioChatPanel from "./ScenarioChatPanel";
import "../styles/scenarios.css";

// The scenario-edition stage shared by "Création de tests" (state 1) and the
// Corrections tab's scenario edition: the expected-result spec on top
// (height draggable via the divider, remembered across sessions) and the
// scenario assistant below. The parent owns the header and the button that
// exits the stage.
export default function ScenarioEditStage({
  testname,
  spec,
  onUpdate,
  emptyHintKey = "creation_spec_empty",
}: {
  testname: string;
  spec: string | null;
  onUpdate: () => void;
  emptyHintKey?: string;
}) {
  const { t } = useI18n();
  const { selectedId } = useEnvironment();
  const [specHeight, setSpecHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem("creationSpecHeight"));
    return Number.isFinite(saved) && saved >= 80 ? saved : 220;
  });
  const stageRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = specHeight;
    const onMove = (ev: MouseEvent) => {
      // Keep enough room for the chat below (input + a few messages).
      const max = (stageRef.current?.clientHeight ?? 600) - 160;
      setSpecHeight(Math.min(Math.max(startH + ev.clientY - startY, 80), Math.max(max, 80)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSpecHeight((h) => {
        localStorage.setItem("creationSpecHeight", String(h));
        return h;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="creation-scenario-stage" ref={stageRef}>
      <div className="creation-scenario-spec-wrap" style={{ height: specHeight }}>
        <div className="scenario-spec">
          <div className="spec-header">
            <span className="spec-label">{t("spec_label_expected")}</span>
          </div>
          <div className="spec-body">
            {spec?.trim() ? (
              <span dangerouslySetInnerHTML={{ __html: renderGherkin(spec) }} />
            ) : (
              <span className="spec-generating">{t(emptyHintKey)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="creation-scenario-divider" title={t("creation_resize_divider_title")} onMouseDown={onDividerMouseDown} />
      <ScenarioChatPanel testname={testname} environmentId={selectedId} onUpdate={onUpdate} />
    </div>
  );
}
