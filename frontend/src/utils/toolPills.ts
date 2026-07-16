export type ToolInput = Record<string, unknown> | null | undefined;

export function shortPath(p: string) {
  return p.replace("/home/procertif/", "~/").replace("/home/benjamin/", "~/");
}

function writeTestFilePath(input: ToolInput) {
  const testname = (input?.testname as string) || "";
  return input?.kind === "actions" ? `data/actionTest/${testname}.json` : `data/versioned/tests/${testname}.spec.ts`;
}

export function formatToolLabel(name: string, input: ToolInput) {
  const n = name.toLowerCase();
  if (n === "writetestfile" && input?.testname) return "✏️ " + writeTestFilePath(input);
  if (n === "readdatafile" && input?.path) {
    const p = input.path as string;
    return (/\.(png|jpe?g|gif|webp)$/i.test(p) ? "🖼 " : "📄 ") + shortPath(p);
  }
  if (n === "listenvironmentvariables") return "🔑 Variables d'environnement";
  if (n === "runtest" && input?.testname) return "▶ " + (input.testname as string) + (input.pending ? " (en attente)" : "");
  if (n === "webfetch" && input?.url) return "🌐 " + (input.url as string).slice(0, 40) + ((input.url as string).length > 40 ? "…" : "");
  return name;
}

export function toolPillClass(name: string) {
  const n = name.toLowerCase();
  if (n === "readdatafile") return "read";
  if (n === "webfetch") return "web";
  if (n === "writetestfile" || n === "writescenariospec") return "write";
  if (n === "runtest") return "bash";
  return "search";
}
