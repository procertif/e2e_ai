import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { Environment } from "../types";

const STORAGE_KEY = "procertif_selected_environment_id";

export function useSelectedEnvironment() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : null;
  });

  useEffect(() => {
    apiFetch("/api/environments")
      .then((r) => r.json())
      .then((data: Environment[]) => setEnvironments(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedId != null) localStorage.setItem(STORAGE_KEY, String(selectedId));
    else localStorage.removeItem(STORAGE_KEY);
  }, [selectedId]);

  // Auto-select when there's exactly one environment — a selection is now
  // required to send a chat message, so don't force the user through an
  // extra click in the common single-environment setup.
  useEffect(() => {
    if (selectedId == null && environments.length === 1) setSelectedId(environments[0].id);
  }, [environments, selectedId]);

  const selectedEnvironment = environments.find((e) => e.id === selectedId) || null;

  return { environments, selectedId, setSelectedId, selectedEnvironment };
}
