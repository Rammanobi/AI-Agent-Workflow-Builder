-- step_results holds durable output of db_write steps.
create table step_results (
  id uuid primary key default gen_random_uuid(),
  step_run_id uuid not null references step_runs(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- notifications: a notify step inserts a row here; a Hasura Event Trigger
-- watches this table (insert) and calls the /api/notify-webhook route.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  step_run_id uuid not null references step_runs(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  payload jsonb not null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_org_id on notifications(org_id);
