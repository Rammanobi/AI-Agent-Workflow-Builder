const COLORS: Record<string, string> = {
  pending: "#999",
  running: "#2563eb",
  paused: "#d97706",
  completed: "#16a34a",
  failed: "#dc2626",
};

export default function RunStatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? "#666";
  const label = status === "paused" ? "paused - awaiting approval" : status;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        color: "#fff",
        background: color,
      }}
    >
      {label}
    </span>
  );
}
