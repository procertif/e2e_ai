import { shortPath } from "../utils/toolPills";
import type { ToolInput } from "../utils/toolPills";

type DiffLine = { type: "same" | "add" | "del"; text: string };

// LCS line diff. old_string/new_string in Edit calls are small snippets (not
// whole files), so the O(n*m) DP table stays cheap; guard anyway in case a
// tool call ever carries something huge.
function diffLines(oldStr: string, newStr: string): DiffLine[] {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  const n = a.length;
  const m = b.length;

  if (n * m > 200000) {
    return [...a.map((text): DiffLine => ({ type: "del", text })), ...b.map((text): DiffLine => ({ type: "add", text }))];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: a[i] });
      i++;
    } else {
      result.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "del", text: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: b[j] });
    j++;
  }
  return result;
}

const MARKER = { same: " ", add: "+", del: "-" };

export function ToolDiffView({ name, input, filePathOverride }: { name: string; input: ToolInput; filePathOverride?: string }) {
  const n = name.toLowerCase();
  if (n !== "writetestfile") return null;

  const testname = (input?.testname as string) || "";
  const filePath = filePathOverride || (input?.kind === "actions" ? `data/actionTest/${testname}.json` : `data/versioned/tests/${testname}.spec.ts`);

  let lines: DiffLine[];
  if (input?.mode === "edit") {
    lines = diffLines((input?.old_string as string) || "", (input?.new_string as string) || "");
  } else if (input?.mode === "create") {
    lines = ((input?.content as string) || "").split("\n").map((text): DiffLine => ({ type: "add", text }));
  } else {
    return null;
  }

  return (
    <div className="tool-diff">
      <div className="tool-diff-file">{shortPath(filePath)}</div>
      <pre className="tool-diff-body">
        {lines.map((l, i) => (
          <div className={`diff-line diff-line--${l.type}`} key={i}>
            <span className="diff-marker">{MARKER[l.type]}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
