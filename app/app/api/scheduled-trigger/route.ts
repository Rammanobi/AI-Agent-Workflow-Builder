import { NextRequest, NextResponse } from "next/server";
import { hasuraAdminRequest } from "@/lib/hasura-admin";
import { createStepRunsForWorkflow, executeFromStep, WorkflowStep } from "@/lib/workflow-executor";

// Target of the cron trigger `poll_scheduled_workflow_triggers` (see
// hasura/metadata/cron_triggers.yaml), which fires every 5 minutes. This
// route is the "scheduled" trigger-type driver: it looks at every
// workflow_triggers row of type `scheduled`, and for each one whose
// `config.interval_minutes` has elapsed since the workflow's last run,
// starts a new run via the same shared executor everything else uses.
//
// There is no end-user session here (cron has no caller to re-check org/role
// against) -- the only gate is the shared webhook secret, and the workflow's
// own `created_by` user is recorded as the run's triggered_by.

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.HASURA_EVENT_WEBHOOK_SECRET || "";
  return req.headers.get("x-webhook-secret") === expected;
}

interface ScheduledTriggerRow {
  id: string;
  config: { interval_minutes?: number };
  workflow: {
    id: string;
    org_id: string;
    created_by: string;
    steps: WorkflowStep[];
    runs: { started_at: string }[];
  };
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ message: "invalid webhook secret" }, { status: 401 });
  }

  const data = await hasuraAdminRequest<{ workflow_triggers: ScheduledTriggerRow[] }>(
    `query GetScheduledTriggers {
      workflow_triggers(where: { type: { _eq: "scheduled" } }) {
        id
        config
        workflow {
          id
          org_id
          created_by
          steps(order_by: { step_order: asc }) { id step_order type config }
          runs(order_by: { started_at: desc }, limit: 1) { started_at }
        }
      }
    }`
  );

  const started: string[] = [];
  const skipped: string[] = [];

  for (const trigger of data.workflow_triggers) {
    const intervalMinutes = trigger.config?.interval_minutes ?? 60;
    const lastRunAt = trigger.workflow.runs[0]?.started_at;
    const dueAt = lastRunAt ? new Date(lastRunAt).getTime() + intervalMinutes * 60_000 : 0;

    if (Date.now() < dueAt) {
      skipped.push(trigger.workflow.id);
      continue;
    }
    if (trigger.workflow.steps.length === 0) {
      skipped.push(trigger.workflow.id);
      continue;
    }

    const org = await hasuraAdminRequest<{ organizations_by_pk: { quota_used: number; quota_limit: number } }>(
      `query GetOrgQuota($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
      { id: trigger.workflow.org_id }
    );
    if (org.organizations_by_pk.quota_used >= org.organizations_by_pk.quota_limit) {
      skipped.push(trigger.workflow.id);
      continue;
    }

    const created = await hasuraAdminRequest<{ insert_workflow_runs_one: { id: string } }>(
      `mutation CreateRun($workflow_id: uuid!, $org_id: uuid!, $triggered_by: uuid!) {
        insert_workflow_runs_one(object: { workflow_id: $workflow_id, org_id: $org_id, triggered_by: $triggered_by, status: "pending" }) { id }
      }`,
      { workflow_id: trigger.workflow.id, org_id: trigger.workflow.org_id, triggered_by: trigger.workflow.created_by }
    );

    await createStepRunsForWorkflow(created.insert_workflow_runs_one.id, trigger.workflow.steps);
    await executeFromStep(created.insert_workflow_runs_one.id, trigger.workflow.steps[0].step_order);
    started.push(created.insert_workflow_runs_one.id);
  }

  return NextResponse.json({ started, skipped });
}
