"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSubscription } from "@apollo/client";
import { useAuthenticationStatus, useUserDefaultRole } from "@nhost/react";
import { SUBSCRIBE_STEP_RUNS } from "@/lib/graphql";
import RunStatusBadge from "@/components/RunStatusBadge";
import ApproveButton from "@/components/ApproveButton";

export default function RunViewPage() {
  const params = useParams<{ id: string; runId: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const role = useUserDefaultRole();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace("/login");
  }, [authLoading, isAuthenticated, router]);

  // Live view: subscribes directly to step_runs filtered by workflow_run_id.
  // Hasura's row permissions (org_id via the workflow_run relationship) apply
  // to subscriptions exactly like queries, so this can never leak another
  // org's run even though the subscription itself has no extra org filter.
  const { data, loading, error } = useSubscription(SUBSCRIBE_STEP_RUNS, {
    variables: { workflow_run_id: params.runId },
    skip: !isAuthenticated,
  });

  const canApprove = role === "owner" || role === "editor";

  if (authLoading || loading) return <p style={{ padding: 24 }}>Connecting...</p>;
  if (error) return <p style={{ padding: 24, color: "crimson" }}>{error.message}</p>;

  const stepRuns = data?.step_runs ?? [];

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Run {params.runId}</h1>
      <a href={`/workflows/${params.id}`}>Back to workflow</a>

      <ol style={{ marginTop: 24, padding: 0 }}>
        {stepRuns.map((sr: any) => (
          <li key={sr.id} className="card" style={{ listStyle: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>
                Step {sr.step_order}: {sr.workflow_step.type}
              </strong>
              <RunStatusBadge status={sr.status} />
            </div>

            {sr.status === "paused" && (
              <div style={{ marginTop: 8 }}>
                <p style={{ color: "#d97706" }}>{sr.workflow_step.config?.message || "Awaiting approval to continue."}</p>
                {canApprove ? (
                  <ApproveButton stepRunId={sr.id} />
                ) : (
                  <p style={{ fontSize: 12, color: "#666" }}>Only an owner or editor can approve this step.</p>
                )}
              </div>
            )}

            {sr.output && (
              <pre style={{ background: "#f6f6f6", padding: 8, borderRadius: 6, overflowX: "auto", fontSize: 12 }}>
                {JSON.stringify(sr.output, null, 2)}
              </pre>
            )}
            {sr.error && <p style={{ color: "crimson" }}>{sr.error}</p>}
          </li>
        ))}
      </ol>
    </main>
  );
}
