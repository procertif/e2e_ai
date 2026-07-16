import { useI18n } from "../i18n/I18nContext";
import { useStickyScroll } from "../utils/useStickyScroll";

// One instance per test card (Tests and Campaigns pages can render several
// of these at once, each with its own independent scroll position) — the
// sticky-scroll hook has to live here rather than at the page level so each
// card tracks whether *it* is scrolled to bottom, not the page as a whole.
export function OutputBlock({ output, copied, onCopy }: { output: string; copied: boolean; onCopy: () => void }) {
  const { t } = useI18n();
  const preRef = useStickyScroll<HTMLPreElement>(output);
  return (
    <div className="output-area visible" draggable={false}>
      <div className="output-toolbar">
        <button type="button" className="btn-copy-output" title={t("btn_copy_output_title")} onClick={onCopy}>
          {copied ? t("btn_copy_output_done") : t("btn_copy_output_title")}
        </button>
      </div>
      <pre className="output-pre" draggable={false} ref={preRef}>
        {output}
      </pre>
    </div>
  );
}
