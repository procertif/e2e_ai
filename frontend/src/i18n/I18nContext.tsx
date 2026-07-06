import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";

type Dict = Record<string, string>;

interface I18nContextValue {
  t: (key: string) => string;
  ready: boolean;
  lang: string;
}

declare global {
  interface Window {
    _lang?: string;
  }
}

const I18nContext = createContext<I18nContextValue>({ t: (k) => k, ready: false, lang: "fr" });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [dict, setDict] = useState<Dict>({});
  const [lang, setLang] = useState("fr");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolvedLang = "en";
      try {
        const res = await fetch("/api/lang");
        const data = await res.json();
        resolvedLang = data.lang || "en";
      } catch {
        resolvedLang = "en";
      }
      if (cancelled) return;
      window._lang = resolvedLang;
      setLang(resolvedLang);
      try {
        const res = await fetch(`/i18n/${resolvedLang}.json`);
        const data = await res.json();
        if (!cancelled) setDict(data);
      } catch {
        // dict stays empty — t() falls back to returning the raw key
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const t = useCallback((key: string) => (dict[key] !== undefined ? dict[key] : key), [dict]);

  return <I18nContext.Provider value={{ t, ready, lang }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
