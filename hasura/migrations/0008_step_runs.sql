create table step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references workflow_steps(id) on delete cascade,
  step_order integer not null,
  status run_status not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);
create index idx_step_runs_workflow_run_id on step_runs(workflow_run_id);
