export const ENVIRONMENT_COLORS: { key: string; hex: string }[] = [
  { key: "red", hex: "#ef4444" },
  { key: "orange", hex: "#f97316" },
  { key: "amber", hex: "#eab308" },
  { key: "green", hex: "#22c55e" },
  { key: "teal", hex: "#14b8a6" },
  { key: "blue", hex: "#3b82f6" },
  { key: "indigo", hex: "#6366f1" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink", hex: "#ec4899" },
  { key: "slate", hex: "#475569" },
];

export function environmentColorHex(key: string) {
  return ENVIRONMENT_COLORS.find((c) => c.key === key)?.hex || "#6b7280";
}
