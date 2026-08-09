import { NextRequest, NextResponse } from "next/server";
import { hasuraAdminRequest, getMembership, roleAtLeast } from "@/lib/hasura-admin";
import { executeFromStep } from "@/lib/workflow-executor";

// ============================================================================
// SECURITY NOTE (same caveat as trigger-workflow-run/route.ts):
//
// approveStep is a Hasura Action, so it bypasses row permissions entirely.
// The only way a paused approval_gate step_run may legitimately resume is
// through THIS handler, and only after independently re-verifying (via the
// admin secret, never trusting forwarded headers alone) that the calling
// user is an owner or editor of the SPECIFIC org that owns this step_run --
// found by walking step_run -> workflow_run -> workflow -> org_id ourselves.
//
// It is deliberately NOT enough for a client to just run
// `update step_runs set status = 'completed'` through the normal GraphQL
// API (and indeed, no update permission exists on step_runs for any role --
// see hasura/metadata/databases/default/tables/step_runs.yaml). The only
// path that resumes execution is this handler calling executeFromStep(),
// which re-runs the shared engine starting at the next step.
// ============================================================================

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.ACTION_WEBHOOK_SECRET || "";
  return req.headers.get("x-webhook-secret") === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ message: "invalid webhook secret" }, { status: 401 });
  }

  const body = await req.json();
  const userId: string | undefined = body?.session_variables?.["x-hasura-user-id"];
  const stepRunId: string | undefined = body?.input?.step_run_id;

  if (!userId) {
    return NextResponse.json({ message: "missing x-hasura-user-id session variable" }, { status: 400 });
  }
  if (!stepRunId) {
    return NextResponse.json({ message: "step_run_id is required" }, { status: 400 });
  }

  // Walk step_run -> workflow_run -> workflow -> org_id via the admin
  // client, so we know the true org this step_run belongs to.
  const data = await hasuraAdminRequest<{
    step_runs_by_pk: {
      id: string;
      status: string;
      step_order: number;
      workflow_run: { id: string; org_id: string };
    } | null;
  }>(
    `query GetStepRunOrg($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id
        status
        step_order
        workflow_run {
          id
          org_id
        }
      }
    }`,
    { id: stepRunId }
  );

  const stepRun = data.step_runs_by_pk;
  if (!stepRun) {
    return NextResponse.json({ message: "step_run not found" }, { status: 404 });
  }
  if (stepRun.status !== "paused") {
    return NextResponse.json({ message: `step_run is not awaiting approval (status: ${stepRun.status})` }, { status: 409 });
  }

  // Layer 2 re-check: only owner/editor of THIS step_run's org may approve.
  const membership = await getMembership(userId, stepRun.workflow_run.org_id);
  if (!membership || !roleAtLeast(membership.role, "editor")) {
    return NextResponse.json({ message: "forbidden: caller is not an editor/owner of this run's org" }, { status: 403 });
  }

  await hasuraAdminRequest(
    `mutation ApproveStepRun($id: uuid!, $approved_by: uuid!, $approved_at: timestamptz!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: { status: "completed", approved_by: $approved_by, approved_at: $approved_at }) {
        id
      }
    }`,
    { id: stepRunId, approved_by: userId, approved_at: new Date().toISOString() }
  );

  const result = await executeFromStep(stepRun.workflow_run.id, stepRun.step_order + 1);

  return NextResponse.json({ step_run_id: stepRunId, status: result.status });
}
