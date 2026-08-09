create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  step_order integer not null,
  type step_type not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (workflow_id, step_order)
);
create index idx_workflow_steps_workflow_id on workflow_steps(workflow_id);
