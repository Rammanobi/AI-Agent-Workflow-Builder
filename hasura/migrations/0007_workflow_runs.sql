create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  status run_status not null default 'pending',
  triggered_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_workflow_runs_workflow_id on workflow_runs(workflow_id);
create index idx_workflow_runs_org_id on workflow_runs(org_id);
