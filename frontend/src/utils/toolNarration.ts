import { shortPath } from "./toolPills";

export interface EntityTitles {
  testTitle: (filename: string) => string;
  campaignTitle: (id: string) => string;
  groupName: (id: string) => string;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

function basename(p: string) {
  return p.split("/").pop() || p;
}

function humanize(name: string) {
  return name.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeReadPath(path: string, titles: EntityTitles): string {
  let m = path.match(/^data\/versioned\/tests\/(.+)\.spec\.ts$/);
  if (m) return `Lecture du test ${titles.testTitle(m[1] + ".spec.ts")}`;

  m = path.match(/^data\/versioned\/campaigns\/([^/]+)\.json$/);
  if (m) return `Lecture de la campagne ${titles.campaignTitle(m[1])}`;

  m = path.match(/^data\/versioned\/groups\/([^/]+)\.json$/);
  if (m) return `Lecture du groupe ${titles.groupName(m[1])}`;

  m = path.match(/^data\/versioned\/scenarios\/(.+)\.json$/);
  if (m) return `Lecture du scénario ${humanize(m[1])}`;

  if (IMAGE_RE.test(path)) return `Lecture de la capture ${basename(path)}`;

  return path ? `Lecture de ${shortPath(path)}` : "Lecture";
}

// correctionFilename overrides whatever the model put in input.testname —
// in correction mode the tool itself ignores that field too (see ia.js's
// ctx.correctionFilename branch), it always targets the one test the whole
// conversation is scoped to.
export function toolLabel(name: string, input: Record<string, unknown> | null | undefined, titles: EntityTitles, correctionFilename?: string): string {
  const n = name.toLowerCase();
  const filename = correctionFilename || (input?.testname ? `${input.testname}.spec.ts` : "");

  if (n === "writetestfile") {
    if (input?.kind === "actions" && !correctionFilename) return `Édition des actions du test ${titles.testTitle(filename)}`;
    return `Édition du test ${titles.testTitle(filename)}`;
  }
  if (n === "readdatafile") return describeReadPath((input?.path as string) || "", titles);
  if (n === "listenvironmentvariables") return "Lecture des variables d'environnement";
  if (n === "runtest") return `Lecture du test ${titles.testTitle(filename)}`;
  if (n === "webfetch") return `Requêtage ${(input?.url as string) || ""}`;
  if (n === "findselector") return "Lecture du code";
  if (n === "writescenariospec") return "Édition du résultat attendu";
  return name;
}

export interface FindSelectorMatch {
  file: string;
  lines: number[];
}

// Only meaningful once the tool's result is back — a line-count for a
// plain-text ReadDataFile, or a per-file match summary for FindSelector's
// grep-style output ("file:line:content" per match). Nothing for the rest,
// intentionally — RunTest's own console dump is rendered directly from the
// raw result by the caller, no parsing needed there.
export function readFileLineInfo(input: Record<string, unknown> | null | undefined, result: string | undefined): string | null {
  if (!result) return null;
  const path = (input?.path as string) || "";
  if (IMAGE_RE.test(path)) return null;
  if (result.startsWith("Error:") || result.startsWith("Access denied")) return null;
  const lineCount = result.split("\n").length;
  return lineCount <= 1 ? "1 ligne" : `lignes 1 à ${lineCount}`;
}

export function findSelectorMatches(result: string | undefined): FindSelectorMatch[] {
  if (!result || result === "No match found." || result.startsWith("Error:")) return [];
  const byFile = new Map<string, number[]>();
  for (const line of result.split("\n")) {
    const m = line.match(/^(.+?):(\d+):/);
    if (!m) continue;
    const [, file, lineNo] = m;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(Number(lineNo));
  }
  return [...byFile.entries()].map(([file, lines]) => ({ file, lines }));
}
