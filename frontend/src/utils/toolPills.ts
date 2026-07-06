export type ToolInput = Record<string, unknown> | null | undefined;

export function shortPath(p: string) {
  return p.replace("/home/procertif/", "~/").replace("/home/benjamin/", "~/");
}

export function formatToolLabel(name: string, input: ToolInput) {
  const n = name.toLowerCase();
  if (n === "read" && input?.file_path) return "📄 " + shortPath(input.file_path as string);
  if (n === "readimage" && input?.file_path) return "🖼 " + shortPath(input.file_path as string);
  if (n === "webfetch" && input?.url) return "🌐 " + (input.url as string).slice(0, 40) + ((input.url as string).length > 40 ? "…" : "");
  if (n === "write" && input?.file_path) return "✏️ " + shortPath(input.file_path as string);
  if (n === "edit" && input?.file_path) return "✏️ " + shortPath(input.file_path as string);
  if (n === "bash" && input?.command) return "$ " + (input.command as string).slice(0, 40) + ((input.command as string).length > 40 ? "…" : "");
  if (input?.query || input?.pattern) return "🔍 " + ((input.query || input.pattern) as string).slice(0, 30);
  return name;
}

export function toolPillClass(name: string) {
  const n = name.toLowerCase();
  if (n === "read") return "read";
  if (n === "readimage") return "image";
  if (n === "webfetch") return "web";
  if (n === "write") return "write";
  if (n === "edit") return "edit";
  if (n === "bash") return "bash";
  return "search";
}
