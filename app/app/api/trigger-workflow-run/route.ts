import { NextRequest, NextResponse } from "next/server";
import { hasuraAdminRequest, getMembership, roleAtLeast } from "@/lib/hasura-admin";
import { createStepRunsForWorkflow, executeFromStep, WorkflowStep } from "@/lib/workflow-executor";

// ============================================================================
// SECURITY NOTE (read this before touching this file):
//
// Hasura Actions do NOT run inside the normal permission system. When Hasura
// calls this handler for `triggerWorkflowRun`, it forwards the caller's
// session variables (x-hasura-user-id, x-hasura-org-id, x-hasura-role) as
// plain HTTP headers, but it has already skipped table row permissions --
// the `permissions:` block in hasura/metadata/actions.yaml only gates WHICH
// ROLES may call the action at all (owner/editor), it does not re-derive or
// verify org membership per-request. If this handler simply trusted the
// forwarded headers and proceeded, a caller could forge
// `x-hasura-org-id: <someone else's org>` in a raw GraphQL request (Actions
// headers are just HTTP headers Hasura relays, not something cryptographically
// bound the way JWT claims are validated at the auth layer -- and even where
// they are validated, the whole point of this check is "don't trust, verify
// against the database ourselves").
//
// So: this handler independently re-queries org_members with the ADMIN
// SECRET to determine the caller's real org_id + role, and only proceeds if
// that lookup allows it. This is "Layer 2" referenced throughout
// WRITEUP.md and hasura/metadata/actions.yaml.
// ============================================================================

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.HASURA_ACTION_SECRET || "";
  return req.headers.get("x-webhook-secret") === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ message: "invalid webhook secret" }, { status: 401 });
  }

  const body = await req.json();
  const userId: string | undefined = body?.session_variables?.["x-hasura-user-id"];
  const workflowId: string | undefined = body?.input?.workflow_id;

  if (!userId) {
    return NextResponse.json({ message: "missing x-hasura-user-id session variable" }, { status: 400 });
  }
  if (!workflowId) {
    return NextResponse.json({ message: "workflow_id is required" }, { status: 400 });
  }

  // Look up the workflow's org_id ourselves (admin secret) -- never trust a
  // client-supplied org_id, only ever a client-supplied workflow_id resolved
  // server-side.
  const workflowData = await hasuraAdminRequest<{ workflows_by_pk: { org_id: string; steps: WorkflowStep[] } | null }>(
    `query GetWorkflowOrg($id: uuid!) {
      workflows_by_pk(id: $id) {
        org_id
        steps(order_by: { step_order: asc }) { id step_order type config }
      }
    }`,
    { id: workflowId }
  );

  const workflow = workflowData.workflows_by_pk;
  if (!workflow) {
    return NextResponse.json({ message: "workflow not found" }, { status: 404 });
  }

  // Layer 2 re-check: is this user actually a member of this workflow's org,
  // with a role permitted to run workflows (editor or owner; viewers cannot)?
  const membership = await getMembership(userId, workflow.org_id);
  if (!membership || !roleAtLeast(membership.role, "editor")) {
    return NextResponse.json({ message: "forbidden: caller is not an editor/owner of this workflow's org" }, { status: 403 });
  }

  if (workflow.steps.length === 0) {
    return NextResponse.json({ message: "workflow has no steps" }, { status: 400 });
  }

  // Quota check happens before any workflow_run row is created.
  const orgData = await hasuraAdminRequest<{ organizations_by_pk: { quota_used: number; quota_limit: number } }>(
    `query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) { quota_used quota_limit }
    }`,
    { id: workflow.org_id }
  );
  const org = orgData.organizations_by_pk;
  if (org.quota_used >= org.quota_limit) {
    return NextResponse.json(
      { message: `quota exceeded: ${org.quota_used}/${org.quota_limit} runs used this billing period` },
      { status: 403 }
    );
  }

  const created = await hasuraAdminRequest<{ insert_workflow_runs_one: { id: string } }>(
    `mutation CreateRun($workflow_id: uuid!, $org_id: uuid!, $triggered_by: uuid!) {
      insert_workflow_runs_one(object: { workflow_id: $workflow_id, org_id: $org_id, triggered_by: $triggered_by, status: "pending" }) {
        id
      }
    }`,
    { workflow_id: workflowId, org_id: workflow.org_id, triggered_by: userId }
  );
  const workflowRunId = created.insert_workflow_runs_one.id;

  await createStepRunsForWorkflow(workflowRunId, workflow.steps);

  // Execute synchronously (this is a "synchronous" Hasura Action). For a
  // long-running production workflow you'd hand this off to a queue instead,
  // but the assignment's step types (llm_call/http_request/db_write/notify/
  // conditional_branch/approval_gate) are all fast enough to run inline, and
  // approval_gate steps stop the loop immediately anyway.
  const result = await executeFromStep(workflowRunId, workflow.steps[0].step_order);

  return NextResponse.json({ workflow_run_id: workflowRunId, status: result.status });
}
