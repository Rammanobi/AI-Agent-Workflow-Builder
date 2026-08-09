"use client";

import { useState } from "react";
import { useMutation } from "@apollo/client";
import { APPROVE_STEP } from "@/lib/graphql";

export default function ApproveButton({ stepRunId }: { stepRunId: string }) {
  const [approveStep, { loading }] = useMutation(APPROVE_STEP);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setError(null);
    try {
      await approveStep({ variables: { step_run_id: stepRunId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "approval failed");
    }
  }

  return (
    <div>
      <button onClick={handleApprove} disabled={loading} style={{ background: "#16a34a", color: "#fff", padding: "4px 12px", borderRadius: 6 }}>
        {loading ? "Approving..." : "Approve"}
      </button>
      {error && <p style={{ color: "crimson", fontSize: 12 }}>{error}</p>}
    </div>
  );
}
