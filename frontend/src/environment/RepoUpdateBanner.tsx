import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "../i18n/I18nContext";
import type { Environment } from "../types";

// Shown on Tests/Campagnes/Conversation whenever the selected environment's
// tracked repository branch has moved past what's checked out in
// data/testedRepositories/ — nudges the user to the Environments page's
// Fetch button rather than silently leaving the AI's FindSelector results
// stale.
export function RepoUpdateBanner({ environment }: { environment: Environment | null }) {
  const { t } = useI18n();
  if (!environment?.hasUpdate) return null;
  return (
    <a className="repo-update-banner" href="/environments">
      ⚠ {t("repo_update_banner").replace("{name}", environment.name)}
    </a>
  );
}

// Same signal as the banner above, but compact — meant to sit right next to
// the target-environment selector instead of taking a full banner row.
export function RepoUpdateIcon({ environment }: { environment: Environment | null }) {
  const { t } = useI18n();
  if (!environment?.hasUpdate) return null;
  return (
    <a
      className="repo-update-icon"
      href="/environments"
      title={t("repo_update_banner").replace("{name}", environment.name)}
    >
      <FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: 13 }} />
    </a>
  );
}
