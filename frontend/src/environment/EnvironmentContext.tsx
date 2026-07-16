import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../api";
import type { Environment } from "../types";

const STORAGE_KEY = "procertif_selected_environment_id";

interface EnvironmentContextValue {
  environments: Environment[];
  environmentsLoaded: boolean;
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  selectedEnvironment: Environment | null;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentsLoaded, setEnvironmentsLoaded] = useState(false);
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : null;
  });

  const setSelectedId = (id: number | null) => {
    setSelectedIdState(id);
    if (id != null) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  };

  useEffect(() => {
    apiFetch("/api/environments")
      .then((r) => r.json())
      .then((data: Environment[]) => setEnvironments(data))
      .catch(() => {})
      .finally(() => setEnvironmentsLoaded(true));
  }, []);

  // A target environment is mandatory as soon as at least one exists — tests
  // are filtered/run against it, so there's no valid "no selection" state
  // once environments are available. Snap to the first one whenever the
  // current selection is empty or points at a deleted environment.
  useEffect(() => {
    if (environments.length === 0) return;
    if (selectedId == null || !environments.some((e) => e.id === selectedId)) {
      setSelectedId(environments[0].id);
    }
  }, [environments, selectedId]);

  const selectedEnvironment = environments.find((e) => e.id === selectedId) || null;

  return (
    <EnvironmentContext.Provider value={{ environments, environmentsLoaded, selectedId, setSelectedId, selectedEnvironment }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) throw new Error("useEnvironment must be used within an EnvironmentProvider");
  return ctx;
}
