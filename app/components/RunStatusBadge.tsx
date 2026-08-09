export default function RunStatusBadge({ status }: { status: string }) {
  const label = status === "paused" ? "paused - awaiting approval" : status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}
