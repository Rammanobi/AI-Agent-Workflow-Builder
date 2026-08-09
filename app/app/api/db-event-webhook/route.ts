import { NextRequest, NextResponse } from "next/server";
import { hasuraAdminRequest } from "@/lib/hasura-admin";
import { createStepRunsForWorkflow, executeFromStep, WorkflowStep } from "@/lib/workflow-executor";

// Target of the Hasura Event Trigger `db_event_on_step_results_insert` (see
// hasura/metadata/databases/default/tables/step_results.yaml). This is the
// "database event" trigger-type driver: any workflow with a
// workflow_triggers row of type `database_event` whose config.watched_table
// matches the table Hasura just told us changed gets a new run started,
// exactly like every other trigger path, via the shared executor.

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.HASURA_EVENT_WEBHOOK_SECRET || "";
  return req.headers.get("x-webhook-secret") === expected;
}

interface DbEventTriggerRow {
  id: string;
  config: { watched_table?: string };
  workflow: {
    id: string;
    org_id: string;
    created_by: string;
    steps: WorkflowStep[];
  };
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ message: "invalid webhook secret" }, { status: 401 });
  }

  const body = await req.json();
  const watchedTable: string | undefined = body?.table?.name;
  if (!watchedTable) {
    return NextResponse.json({ message: "no table name in event payload" }, { status: 400 });
  }

  const data = await hasuraAdminRequest<{ workflow_triggers: DbEventTriggerRow[] }>(
    `query GetDbEventTriggers {
      workflow_triggers(where: { type: { _eq: "database_event" } }) {
        id
        config
        workflow {
          id
          org_id
          created_by
          steps(order_by: { step_order: asc }) { id step_order type config }
        }
      }
    }`
  );

  const matching = data.workflow_triggers.filter((t) => t.config?.watched_table === watchedTable);
  const started: string[] = [];

  for (const trigger of matching) {
    if (trigger.workflow.steps.length === 0) continue;

    const org = await hasuraAdminRequest<{ organizations_by_pk: { quota_used: number; quota_limit: number } }>(
      `query GetOrgQuota($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
      { id: trigger.workflow.org_id }
    );
    if (org.organizations_by_pk.quota_used >= org.organizations_by_pk.quota_limit) continue;

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

  return NextResponse.json({ started });
}
