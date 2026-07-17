import { NavLink } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faListCheck,
  faFlagCheckered,
  faFolderOpen,
  faWandMagicSparkles,
  faGlobe,
  faArrowsRotate,
  faGear,
} from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "../i18n/I18nContext";

const NAV_ITEMS: { to: string; end?: boolean; i18nKey: string; icon: IconDefinition }[] = [
  { to: "/", end: true, i18nKey: "nav_tests", icon: faListCheck },
  { to: "/campaigns", i18nKey: "nav_campaigns", icon: faFlagCheckered },
  { to: "/groups", i18nKey: "nav_groups", icon: faFolderOpen },
  { to: "/logs", i18nKey: "nav_logs", icon: faWandMagicSparkles },
  { to: "/environments", i18nKey: "nav_environments", icon: faGlobe },
  { to: "/versioning", i18nKey: "nav_versioning", icon: faArrowsRotate },
  { to: "/configuration", i18nKey: "nav_configuration", icon: faGear },
];

export default function Sidebar() {
  const { t } = useI18n();
  return (
    <aside className="app-sidebar">
      <div className="sidebar-label">{t("sidebar_label")}</div>
      <hr className="divider" />
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              "sidebar-link" + (isActive ? " sidebar-link--active" : "")
            }
          >
            <FontAwesomeIcon icon={item.icon} fixedWidth style={{ fontSize: 14 }} />
            <span>{t(item.i18nKey)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
