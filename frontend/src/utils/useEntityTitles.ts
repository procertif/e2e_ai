import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { Campaign, Group, Test } from "../types";

// Resolves the human-readable name behind a filename/id that a tool call
// only ever carries in its raw form (a bare testname, a campaign's random
// id…) — shared by the classic Chat page and the Correction IA tab so a
// WriteTestFile/ReadDataFile/RunTest pill can say "Édition du test <Titre>"
// instead of the underlying file path.
export function useEntityTitles() {
  const [tests, setTests] = useState<Test[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    apiFetch("/api/tests").then((r) => r.json()).then(setTests).catch(() => {});
    apiFetch("/api/campaigns").then((r) => r.json()).then(setCampaigns).catch(() => {});
    apiFetch("/api/groups").then((r) => r.json()).then(setGroups).catch(() => {});
  }, []);

  const testTitle = (filename: string) => {
    const info = tests.find((x) => x.filename === filename);
    return info?.alias || info?.name || filename;
  };

  const campaignTitle = (id: string) => {
    const c = campaigns.find((x) => x.id === id);
    return c?.title || id;
  };

  const groupName = (id: string) => {
    const g = groups.find((x) => x.id === id);
    return g?.name || id;
  };

  return { testTitle, campaignTitle, groupName };
}
