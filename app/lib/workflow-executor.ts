import { hasuraAdminRequest } from "./hasura-admin";

// ============================================================================
// Shared step-execution engine.
//
// Both app/app/api/trigger-workflow-run/route.ts (starts a run from step 1)
// and app/app/api/approve-step/route.ts (resumes a run after an
// approval_gate) call `executeFromStep` below, so there is exactly one code
// path that actually runs steps -- resuming after approval is NOT a special
// case, it's just "call the same loop starting one step later."
// ============================================================================

export type StepType = "llm_call" | "http_request" | "db_write" | "notify" | "conditional_branch" | "approval_gate";
export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed";

export interface WorkflowStep {
  id: string;
  step_order: number;
  type: StepType;
  config: Record<string, any>;
}

export interface StepRun {
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  step_order: number;
  status: RunStatus;
  input: Record<string, any>;
  output: Record<string, any> | null;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (firstError) {
    try {
      return await fn();
    } catch (secondError) {
      throw secondError instanceof Error ? secondError : new Error(String(secondError));
    }
  }
}

/**
 * llm_call step. Calls Groq's OpenAI-compatible chat completions endpoint.
 *
 * STUB DISCLOSURE: no Groq API key is configured for this assignment yet.
 * When GROQ_API_KEY is unset, this function does NOT make a network call --
 * it returns a deterministic stubbed completion after an artificial 1.5s
 * delay (to make the "running" UI state visibly real during a demo). This is
 * called out again in README.md. Once GROQ_API_KEY is set, this same
 * function makes a real HTTP call, with exactly one retry on failure.
 */
async function executeLlmCall(config: Record<string, any>, previousOutput: unknown): Promise<Record<string, any>> {
  const prompt: string = config.prompt ?? "";
  const model: string = config.model ?? "llama-3.1-8b-instant";
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      stubbed: true,
      note: "GROQ_API_KEY not set -- returning a stubbed completion instead of calling Groq.",
      model,
      prompt,
      completion: `[stubbed llm response] Echoing prompt: ${prompt.slice(0, 200)}`,
    };
  }

  return withOneRetry(async () => {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: config.system_prompt ?? "You are a helpful workflow step." },
          { role: "user", content: renderTemplate(prompt, previousOutput) },
        ],
        temperature: config.temperature ?? 0.7,
      }),
    });
    if (!res.ok) {
      throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return {
      stubbed: false,
      model,
      completion: json.choices?.[0]?.message?.content ?? "",
      raw: json,
    };
  });
}

/** http_request step: plain fetch, one retry on failure. */
async function executeHttpRequest(config: Record<string, any>): Promise<Record<string, any>> {
  return withOneRetry(async () => {
    const res = await fetch(config.url, {
      method: config.method ?? "GET",
      headers: config.headers ?? {},
      body: config.body ? JSON.stringify(config.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON, keep as text */
    }
    if (!res.ok) {
      throw new Error(`http_request failed: ${res.status} ${text}`);
    }
    return { status: res.status, body };
  });
}

/** db_write step: inserts config.data (optionally merged with previous output) into step_results. */
async function executeDbWrite(config: Record<string, any>, stepRunId: string, previousOutput: unknown): Promise<Record<string, any>> {
  const data = config.merge_previous_output ? { ...config.data, previous_output: previousOutput } : config.data ?? {};
  const result = await hasuraAdminRequest<{ insert_step_results_one: { id: string } }>(
    `mutation InsertStepResult($step_run_id: uuid!, $data: jsonb!) {
      insert_step_results_one(object: { step_run_id: $step_run_id, data: $data }) {
        id
      }
    }`,
    { step_run_id: stepRunId, data }
  );
  return { step_result_id: result.insert_step_results_one.id, data };
}

/** notify step: inserts a row into notifications; a Hasura Event Trigger delivers it. */
async function executeNotify(
  config: Record<string, any>,
  stepRunId: string,
  workflowRunId: string,
  orgId: string
): Promise<Record<string, any>> {
  const payload = { message: config.message ?? "", channel: config.channel ?? "default", ...config.extra };
  const result = await hasuraAdminRequest<{ insert_notifications_one: { id: string } }>(
    `mutation InsertNotification($step_run_id: uuid!, $workflow_run_id: uuid!, $org_id: uuid!, $payload: jsonb!) {
      insert_notifications_one(object: { step_run_id: $step_run_id, workflow_run_id: $workflow_run_id, org_id: $org_id, payload: $payload }) {
        id
      }
    }`,
    { step_run_id: stepRunId, workflow_run_id: workflowRunId, org_id: orgId, payload }
  );
  return { notification_id: result.insert_notifications_one.id, payload };
}

/** conditional_branch step: evaluates previous step's output against config. Never fails the run. */
function executeConditionalBranch(config: Record<string, any>, previousOutput: any): Record<string, any> {
  const { field, operator, value } = config;
  const actual = field ? getByPath(previousOutput, field) : previousOutput;
  let matched = false;
  switch (operator) {
    case "eq":
      matched = actual === value;
      break;
    case "neq":
      matched = actual !== value;
      break;
    case "contains":
      matched = typeof actual === "string" && actual.includes(value);
      break;
    case "gt":
      matched = Number(actual) > Number(value);
      break;
    case "lt":
      matched = Number(actual) < Number(value);
      break;
    default:
      matched = Boolean(actual);
  }
  return { matched, actual, operator, value };
}

function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function renderTemplate(template: string, previousOutput: unknown): string {
  if (!template.includes("{{previous_output}}")) return template;
  return template.replace("{{previous_output}}", JSON.stringify(previousOutput ?? null));
}

async function updateStepRun(id: string, fields: Record<string, any>): Promise<void> {
  await hasuraAdminRequest(
    `mutation UpdateStepRun($id: uuid!, $set: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id }
    }`,
    { id, set: fields }
  );
}

async function updateWorkflowRun(id: string, fields: Record<string, any>): Promise<void> {
  await hasuraAdminRequest(
    `mutation UpdateWorkflowRun($id: uuid!, $set: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id }
    }`,
    { id, set: fields }
  );
}

async function incrementQuota(orgId: string): Promise<void> {
  await hasuraAdminRequest(
    `mutation IncrementQuota($org_id: uuid!) {
      update_organizations_by_pk(pk_columns: { id: $org_id }, _inc: { quota_used: 1 }) { id }
    }`,
    { org_id: orgId }
  );
}

interface RunContext {
  workflowRunId: string;
  orgId: string;
  steps: WorkflowStep[];
  stepRuns: StepRun[];
}

async function fetchRunContext(workflowRunId: string): Promise<RunContext> {
  const data = await hasuraAdminRequest<{
    workflow_runs_by_pk: { org_id: string; workflow: { steps: WorkflowStep[] } };
    step_runs: StepRun[];
  }>(
    `query FetchRunContext($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        org_id
        workflow {
          steps(order_by: { step_order: asc }) {
            id
            step_order
            type
            config
          }
        }
      }
      step_runs(where: { workflow_run_id: { _eq: $id } }, order_by: { step_order: asc }) {
        id
        workflow_run_id
        workflow_step_id
        step_order
        status
        input
        output
      }
    }`,
    { id: workflowRunId }
  );
  return {
    workflowRunId,
    orgId: data.workflow_runs_by_pk.org_id,
    steps: data.workflow_runs_by_pk.workflow.steps,
    stepRuns: data.step_runs,
  };
}

/**
 * Create a pending step_runs row for every workflow_step, in order. Called
 * once when a run starts (from the triggerWorkflowRun handler). Resuming
 * after an approval never calls this again -- it reuses the rows created here.
 */
export async function createStepRunsForWorkflow(workflowRunId: string, steps: WorkflowStep[]): Promise<void> {
  await hasuraAdminRequest(
    `mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
      insert_step_runs(objects: $objects) { affected_rows }
    }`,
    {
      objects: steps.map((s) => ({
        workflow_run_id: workflowRunId,
        workflow_step_id: s.id,
        step_order: s.step_order,
        status: "pending",
        input: {},
      })),
    }
  );
}

/**
 * Executes workflow steps in order starting at `fromStepOrder` (inclusive).
 * Stops early (workflow_run.status = 'paused') on an approval_gate step that
 * has not yet been approved, or (status = 'failed') if a step exhausts its
 * retries. On natural completion of the last step, marks the run 'completed'
 * and increments the org's quota_used exactly once.
 */
export async function executeFromStep(workflowRunId: string, fromStepOrder: number): Promise<{ status: RunStatus }> {
  const ctx = await fetchRunContext(workflowRunId);
  await updateWorkflowRun(workflowRunId, { status: "running" });

  let previousOutput: unknown = null;
  // Seed previousOutput from the last completed step before fromStepOrder,
  // so a resumed run can still template off of earlier output.
  const priorCompleted = ctx.stepRuns
    .filter((sr) => sr.step_order < fromStepOrder && sr.status === "completed")
    .sort((a, b) => b.step_order - a.step_order)[0];
  if (priorCompleted) previousOutput = priorCompleted.output;

  const orderedSteps = ctx.steps.filter((s) => s.step_order >= fromStepOrder).sort((a, b) => a.step_order - b.step_order);

  for (const step of orderedSteps) {
    const stepRun = ctx.stepRuns.find((sr) => sr.workflow_step_id === step.id);
    if (!stepRun) {
      throw new Error(`No step_run found for workflow_step ${step.id}; createStepRunsForWorkflow was not called`);
    }

    await updateStepRun(stepRun.id, { status: "running", started_at: new Date().toISOString(), input: { previous_output: previousOutput } });

    try {
      if (step.type === "approval_gate") {
        // Pause here. The run resumes ONLY via the approveStep Action, which
        // re-checks the caller's role (Layer 2) before calling executeFromStep
        // again with fromStepOrder = step.step_order + 1. A plain database
        // UPDATE of step_runs.status can never resume the run by itself,
        // because nothing else calls executeFromStep.
        await updateStepRun(stepRun.id, { status: "paused" });
        await updateWorkflowRun(workflowRunId, { status: "paused" });
        return { status: "paused" };
      }

      let output: Record<string, any>;
      switch (step.type) {
        case "llm_call":
          output = await executeLlmCall(step.config, previousOutput);
          break;
        case "http_request":
          output = await executeHttpRequest(step.config);
          break;
        case "db_write":
          output = await executeDbWrite(step.config, stepRun.id, previousOutput);
          break;
        case "notify":
          output = await executeNotify(step.config, stepRun.id, workflowRunId, ctx.orgId);
          break;
        case "conditional_branch":
          output = executeConditionalBranch(step.config, previousOutput);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      await updateStepRun(stepRun.id, { status: "completed", output, completed_at: new Date().toISOString() });
      previousOutput = output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateStepRun(stepRun.id, { status: "failed", error: message, completed_at: new Date().toISOString() });
      await updateWorkflowRun(workflowRunId, { status: "failed", completed_at: new Date().toISOString() });
      return { status: "failed" };
    }
  }

  await updateWorkflowRun(workflowRunId, { status: "completed", completed_at: new Date().toISOString() });
  await incrementQuota(ctx.orgId);
  return { status: "completed" };
}
