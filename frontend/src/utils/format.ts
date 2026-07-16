export const GROUP_COLORS = [
  { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
  { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
  { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
  { bg: "#fce7f3", text: "#be185d", border: "#fbcfe8" },
  { bg: "#e0e7ff", text: "#4338ca", border: "#c7d2fe" },
  { bg: "#ffedd5", text: "#c2410c", border: "#fed7aa" },
  { bg: "#f0fdfa", text: "#0f766e", border: "#99f6e4" },
  { bg: "#fdf4ff", text: "#7e22ce", border: "#f0abfc" },
];

export function groupColor(idx: number) {
  return GROUP_COLORS[idx % GROUP_COLORS.length];
}

export function stripAnsi(str: string) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function formatDuration(ms: number | undefined | null) {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

// True if every whitespace-separated token in `query` is a substring of some
// whitespace/hyphen-separated token in `name`.
export function fuzzyMatch(name: string, query: string) {
  const q = query.toLowerCase().trim();
  const queryTokens = q.split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) return true;
  const nameTokens = name.toLowerCase().split(/[\s-]+/).filter(Boolean);
  return queryTokens.every((qt) => nameTokens.some((nt) => nt.includes(qt)));
}

export function filenameToFolder(filename: string) {
  return filename.replace(/^\d+-/, "").replace(/\.spec\.ts$/, "");
}

// Pulls the assertion/error block (message, diff, code frame, first stack
// line) out of a raw Playwright --reporter=line log, dropping the noisy
// "Error Context: test-results/.../error-context.md" tail and anything after.
export function extractError(output: string): string | null {
  const idx = output.indexOf("Error:");
  if (idx === -1) return null;
  const rest = output.slice(idx);
  let end = rest.length;
  for (const marker of ["\n    Error Context:", "\n\n\n"]) {
    const i = rest.indexOf(marker);
    if (i !== -1) end = Math.min(end, i);
  }
  return rest.slice(0, end).trim();
}

export function escHtml(s: unknown) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
