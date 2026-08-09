import { gql } from "@apollo/client";

// ---------------------------------------------------------------------------
// Queries / mutations / subscriptions used by the app. These all run under
// the signed-in user's role (owner/editor/viewer) via nhost's Apollo client,
// so Layer 1 (Hasura row permissions) governs what each of these can return
// or write. Nothing here needs the admin secret -- that's only used
// server-side in lib/hasura-admin.ts.
// ---------------------------------------------------------------------------

export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows {
    workflows(order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      updated_at
      steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        config
      }
      triggers {
        id
        type
        config
      }
      runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        completed_at
      }
    }
  }
`;

export const GET_WORKFLOW_BY_ID = gql`
  query GetWorkflowById($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        config
      }
      triggers {
        id
        type
        config
      }
      runs(order_by: { started_at: desc }, limit: 10) {
        id
        status
        started_at
        completed_at
      }
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($org_id: uuid!, $name: String!, $description: String, $created_by: uuid!) {
    insert_workflows_one(object: { org_id: $org_id, name: $name, description: $description, created_by: $created_by }) {
      id
    }
  }
`;

export const UPSERT_STEP = gql`
  mutation UpsertStep($object: workflow_steps_insert_input!) {
    insert_workflow_steps_one(
      object: $object
      on_conflict: { constraint: workflow_steps_workflow_id_step_order_key, update_columns: [type, config] }
    ) {
      id
      step_order
      type
      config
    }
  }
`;

export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const UPSERT_TRIGGER = gql`
  mutation UpsertTrigger($workflow_id: uuid!, $type: trigger_type!, $config: jsonb!, $created_by: uuid!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflow_id, type: $type, config: $config, created_by: $created_by }) {
      id
      type
      config
    }
  }
`;

export const GET_STEP_RUNS_FOR_RUN = gql`
  query GetStepRunsForRun($workflow_run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflow_run_id } }, order_by: { step_order: asc }) {
      id
      step_order
      status
      input
      output
      error
      approved_by
      approved_at
      started_at
      completed_at
      workflow_step {
        id
        type
        config
      }
    }
    workflow_runs_by_pk(id: $workflow_run_id) {
      id
      status
      started_at
      completed_at
    }
  }
`;

export const SUBSCRIBE_STEP_RUNS = gql`
  subscription SubscribeStepRuns($workflow_run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflow_run_id } }, order_by: { step_order: asc }) {
      id
      step_order
      status
      input
      output
      error
      approved_by
      approved_at
      started_at
      completed_at
      workflow_step {
        id
        type
        config
      }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = gql`
  subscription SubscribeWorkflowRun($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      status
      started_at
      completed_at
    }
  }
`;

export const GET_ORG_USAGE = gql`
  query GetOrgUsage($org_id: uuid!) {
    org_usage_this_month(where: { org_id: { _eq: $org_id } }) {
      org_id
      org_name
      quota_limit
      quota_used
      runs_this_month
    }
  }
`;

// triggerWorkflowRun / approveStep are Hasura Actions, not plain
// table mutations -- see hasura/metadata/actions.yaml and
// app/app/api/{trigger-workflow-run,approve-step}/route.ts.
export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      workflow_run_id
      status
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      step_run_id
      status
    }
  }
`;
