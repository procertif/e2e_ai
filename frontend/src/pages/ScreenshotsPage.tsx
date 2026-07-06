import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { fuzzyMatch } from "../utils/format";
import "../styles/screenshots.css";

interface Screenshot {
  file: string;
  url: string;
}

interface ScreenshotGroup {
  folder: string;
  testName: string;
  screenshots: Screenshot[];
}

interface LightboxItem extends Screenshot {
  testName: string;
  label: string;
}

interface LightboxState {
  items: LightboxItem[];
  index: number;
}

type ActionsMap = Record<string, Record<number, string>>;

function screenshotLabel(file: string, folder: string, actionsMap: ActionsMap) {
  const match = file.match(/^(\d+)-/);
  const idx = match ? parseInt(match[1]) : null;
  return (idx !== null && actionsMap[folder]?.[idx]) || file.replace(/\.png$/, "").replace(/^\d+-/, "");
}

export default function ScreenshotsPage() {
  const { t, ready } = useI18n();
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get("f");

  const [groups, setGroups] = useState<ScreenshotGroup[] | null>(null);
  const [error, setError] = useState(false);
  const [actionsMap, setActionsMap] = useState<ActionsMap>({});
  const [query, setQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const [allGroups, session]: [ScreenshotGroup[], { all: string[]; failed: string[] } | null] = await Promise.all([
          apiFetch("/api/screenshots").then((r) => r.json()),
          filterParam
            ? apiFetch("/api/session").then((r) => (r.ok ? r.json() : null)).catch(() => null)
            : Promise.resolve(null),
        ]);

        const actionsResults = await Promise.all(
          allGroups.map((g) =>
            apiFetch(`/api/actions/${encodeURIComponent(g.folder)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ),
        );
        const nextActionsMap: ActionsMap = {};
        allGroups.forEach((g, i) => {
          const data = actionsResults[i];
          if (data?.actions) {
            nextActionsMap[g.folder] = {};
            for (const a of data.actions) nextActionsMap[g.folder][a.index] = a.description;
          }
        });
        setActionsMap(nextActionsMap);

        let finalGroups = allGroups;
        if (filterParam && session) {
          const folders = new Set(filterParam === "failed" ? session.failed : session.all);
          finalGroups = allGroups.filter((g) => folders.has(g.folder));
          setOpenFolders(new Set(finalGroups.map((g) => g.folder)));
        }
        setGroups(finalGroups);
      } catch {
        setError(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filterParam]);

  const filtered = useMemo(() => {
    if (!groups) return [];
    return groups.filter((g) => fuzzyMatch(g.testName, query));
  }, [groups, query]);

  const toggleFolder = (folder: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const closeAll = () => setOpenFolders(new Set());

  const openLightbox = (group: ScreenshotGroup, localIndex: number) => {
    const items: LightboxItem[] = group.screenshots.map((s) => ({
      ...s,
      testName: group.testName,
      label: screenshotLabel(s.file, group.folder, actionsMap),
    }));
    setLightbox({ items, index: localIndex });
  };

  const closeLightbox = () => setLightbox(null);
  const lightboxPrev = () => setLightbox((lb) => (lb && lb.index > 0 ? { ...lb, index: lb.index - 1 } : lb));
  const lightboxNext = () =>
    setLightbox((lb) => (lb && lb.index < lb.items.length - 1 ? { ...lb, index: lb.index + 1 } : lb));

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lightboxPrev();
      if (e.key === "ArrowRight") lightboxNext();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lightbox]);

  return (
    <>
      <div className="app-topbar">
        <h1>{t("screenshots_title")}</h1>
        <span className="badge-env">TEST RESULTS</span>
        <div className="ms-auto d-flex align-items-center gap-2">
          <div className="search-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zm-5.242 1.156a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder={t("search_test_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="btn btn-outline-secondary btn-sm"
            style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}
            onClick={closeAll}
          >
            {t("btn_close_all")}
          </button>
        </div>
      </div>

      <div className="app-content">
        <div id="groups-container">
          {error && (
            <div className="empty-state">
              <p style={{ color: "#dc3545" }}>{t("load_error")}</p>
            </div>
          )}
          {!error && groups === null && (
            <div className="empty-state">
              <p>{t("loading")}</p>
            </div>
          )}
          {!error && groups !== null && filtered.length === 0 && (
            <div className="no-results">
              {t("search_test_placeholder").replace("Rechercher un test…", "")}« {query} ».
            </div>
          )}
          {filtered.map((g) => {
            const count = g.screenshots.length;
            const isOpen = openFolders.has(g.folder);
            return (
              <div className={"test-group" + (isOpen ? " is-open" : "")} key={g.folder}>
                <div className="test-group-header" onClick={() => toggleFolder(g.folder)}>
                  <p className="test-group-title">{g.testName}</p>
                  <span className="test-group-meta">
                    {count} screenshot{count > 1 ? "s" : ""}
                  </span>
                  <span className="test-group-chevron">›</span>
                </div>
                <div className="test-group-body">
                  <div className="screenshots-grid">
                    {g.screenshots.map((s, i) => {
                      const label = screenshotLabel(s.file, g.folder, actionsMap);
                      return (
                        <div className="screenshot-card-wrap" data-tooltip={label} key={s.file}>
                          <div className="screenshot-card" onClick={() => openLightbox(g, i)}>
                            <img className="screenshot-thumb" src={s.url} alt={s.file} loading="lazy" />
                            <div className="screenshot-label">{label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {lightbox && (
        <div
          id="lightbox"
          className="lightbox-overlay"
          style={{ display: "flex" }}
          onClick={(e) => {
            if ((e.target as HTMLElement).id === "lightbox") closeLightbox();
          }}
        >
          <button className="lightbox-close" onClick={closeLightbox}>
            ×
          </button>
          <button
            className="lightbox-nav prev"
            style={{ display: lightbox.index === 0 ? "none" : "" }}
            onClick={(e) => {
              e.stopPropagation();
              lightboxPrev();
            }}
          >
            ‹
          </button>
          <img className="lightbox-img" src={lightbox.items[lightbox.index].url} alt="" />
          <button
            className="lightbox-nav next"
            style={{ display: lightbox.index === lightbox.items.length - 1 ? "none" : "" }}
            onClick={(e) => {
              e.stopPropagation();
              lightboxNext();
            }}
          >
            ›
          </button>
          <div className="lightbox-counter">
            {lightbox.index + 1} / {lightbox.items.length}
          </div>
          <div className="lightbox-caption">
            {lightbox.items[lightbox.index].testName} — {lightbox.items[lightbox.index].label}
          </div>
        </div>
      )}
    </>
  );
}
