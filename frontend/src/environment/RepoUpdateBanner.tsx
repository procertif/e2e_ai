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
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
        <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
      </svg>
    </a>
  );
}
