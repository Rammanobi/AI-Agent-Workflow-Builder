"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@apollo/client";
import { useAuthenticationStatus, useUserData, useUserDefaultRole } from "@nhost/react";
import { GET_WORKFLOW_BY_ID, TRIGGER_WORKFLOW_RUN, UPSERT_STEP, UPSERT_TRIGGER, DELETE_STEP } from "@/lib/graphql";
import StepEditor, { StepFormValue } from "@/components/StepEditor";
import TriggerEditor, { TriggerFormValue } from "@/components/TriggerEditor";
import RunStatusBadge from "@/components/RunStatusBadge";

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const user = useUserData();
  const role = useUserDefaultRole(); // "owner" | "editor" | "viewer" -- set per-org via Hasura's default role claim

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace("/login");
  }, [authLoading, isAuthenticated, router]);

  const { data, loading, error, refetch } = useQuery(GET_WORKFLOW_BY_ID, {
    variables: { id: params.id },
    skip: !isAuthenticated,
  });

  const [upsertStep] = useMutation(UPSERT_STEP);
  const [deleteStep] = useMutation(DELETE_STEP);
  const [upsertTrigger] = useMutation(UPSERT_TRIGGER);
  const [triggerRun, { loading: running, error: runError }] = useMutation(TRIGGER_WORKFLOW_RUN);

  const [steps, setSteps] = useState<StepFormValue[]>([]);
  const [trigger, setTrigger] = useState<TriggerFormValue>({ type: "manual", config: {} });

  useEffect(() => {
    if (!data?.workflows_by_pk) return;
    setSteps(
      data.workflows_by_pk.steps.map((s: any) => ({ step_order: s.step_order, type: s.type, config: s.config }))
    );
    if (data.workflows_by_pk.triggers[0]) {
      setTrigger({ type: data.workflows_by_pk.triggers[0].type, config: data.workflows_by_pk.triggers[0].config });
    }
  }, [data]);

  if (authLoading || loading) return <p style={{ padding: 24 }}>Loading...</p>;
  if (error) return <p style={{ padding: 24, color: "crimson" }}>{error.message}</p>;
  if (!data?.workflows_by_pk) return <p style={{ padding: 24 }}>Workflow not found.</p>;

  const isViewer = role === "viewer";
  const isOwner = role === "owner";
  const workflowId = params.id;

  function addStep() {
    setSteps((prev) => [...prev, { step_order: prev.length + 1, type: "llm_call", config: {} }]);
  }

  async function saveStep(index: number, value: StepFormValue) {
    const next = [...steps];
    next[index] = value;
    setSteps(next);
    await upsertStep({
      variables: {
        object: {
          workflow_id: workflowId,
          step_order: value.step_order,
          type: value.type,
          config: value.config,
          created_by: user?.id,
        },
      },
    });
  }

  async function removeStep(index: number) {
    const removed = data.workflows_by_pk.steps[index];
    setSteps((prev) => prev.filter((_, i) => i !== index));
    if (removed?.id) await deleteStep({ variables: { id: removed.id } });
    refetch();
  }

  async function saveTrigger(value: TriggerFormValue) {
    setTrigger(value);
    await upsertTrigger({
      variables: { workflow_id: workflowId, type: value.type, config: value.config, created_by: user?.id },
    });
  }

  async function handleRun() {
    const result = await triggerRun({ variables: { workflow_id: workflowId } });
    const runId = result.data?.triggerWorkflowRun?.workflow_run_id;
    if (runId) router.push(`/workflows/${workflowId}/runs/${runId}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>{data.workflows_by_pk.name}</h1>
      <p style={{ color: "#666" }}>{data.workflows_by_pk.description}</p>

      <h2>Steps</h2>
      {steps.map((s, i) => (
        <StepEditor
          key={i}
          value={s}
          onChange={(v) => saveStep(i, v)}
          onDelete={() => removeStep(i)}
          canEditRestrictedTypes={isOwner}
        />
      ))}
      {!isViewer && <button onClick={addStep}>+ Add step</button>}

      <h2 style={{ marginTop: 24 }}>Trigger</h2>
      <TriggerEditor value={trigger} onChange={saveTrigger} canEditWebhook={isOwner} />

      <h2 style={{ marginTop: 24 }}>Runs</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {data.workflows_by_pk.runs.map((r: any) => (
          <li key={r.id} style={{ marginBottom: 4 }}>
            <a href={`/workflows/${workflowId}/runs/${r.id}`}>{new Date(r.started_at).toLocaleString()}</a>{" "}
            <RunStatusBadge status={r.status} />
          </li>
        ))}
      </ul>

      {/* Run button hidden for viewers -- both here and server-side, since the
          Action's own permissions (hasura/metadata/actions.yaml) and handler
          re-check (app/app/api/trigger-workflow-run/route.ts) reject viewers too. */}
      {!isViewer && (
        <button onClick={handleRun} disabled={running} style={{ marginTop: 16, background: "#2563eb", color: "#fff", padding: "8px 16px", borderRadius: 6 }}>
          {running ? "Starting run..." : "Run workflow"}
        </button>
      )}
      {runError && <p style={{ color: "crimson" }}>{runError.message}</p>}
    </main>
  );
}
