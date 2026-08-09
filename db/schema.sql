-- ============================================================================
-- AI Agent Workflow Builder — consolidated reference schema
-- This file is NOT applied directly; it exists as a single, readable reference
-- for the whole schema. The authoritative, applied source of truth is the set
-- of incremental files under hasura/migrations/ (one logical change per file).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type org_role as enum ('owner', 'editor', 'viewer');
create type step_type as enum ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate');
create type trigger_type as enum ('manual', 'scheduled', 'webhook', 'database_event');
create type run_status as enum ('pending', 'running', 'paused', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_limit integer not null default 100,
  quota_used integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- org_members — join of nhost auth.users to organizations with a role.
-- This is the single source of truth for "who can do what in which org" and
-- is what BOTH the Hasura row permissions and the Action-handler code re-check.
-- ---------------------------------------------------------------------------
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null, -- references auth.users(id) (nhost-managed schema)
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_members_org_id on org_members(org_id);
create index idx_org_members_user_id on org_members(user_id);

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------
create table workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workflows_org_id on workflows(org_id);

-- ---------------------------------------------------------------------------
-- workflow_steps — ordered steps belonging to a workflow.
-- created_by is required so the defense-in-depth trigger below can check the
-- creator's role in org_members without depending on a session variable.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- workflow_triggers
-- ---------------------------------------------------------------------------
create table workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  type trigger_type not null,
  config jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index idx_workflow_triggers_workflow_id on workflow_triggers(workflow_id);

-- ---------------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- step_runs — one row per executed (or paused) step within a workflow_run.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- step_results — durable output of db_write steps.
-- ---------------------------------------------------------------------------
create table step_results (
  id uuid primary key default gen_random_uuid(),
  step_run_id uuid not null references step_runs(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notifications — a notify step inserts a row here; a Hasura Event Trigger
-- watches this table and calls /api/notify-webhook.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- org_usage_this_month — convenience view for the QuotaBar component.
-- ---------------------------------------------------------------------------
create view org_usage_this_month as
select
  o.id as org_id,
  o.name as org_name,
  o.quota_limit,
  o.quota_used,
  count(wr.id) filter (
    where wr.started_at >= date_trunc('month', now())
  ) as runs_this_month
from organizations o
left join workflow_runs wr on wr.org_id = o.id
group by o.id, o.name, o.quota_limit, o.quota_used;

-- ---------------------------------------------------------------------------
-- Defense-in-depth: only an 'owner' may create restricted step/trigger types.
-- This mirrors the Hasura column-check permission but is enforced at the DB
-- layer too, so it holds even if metadata is misconfigured or a query goes
-- through the admin secret without an application-level check.
-- ---------------------------------------------------------------------------
create or replace function enforce_owner_only_step_types() returns trigger as $$
declare
  v_org_id uuid;
  v_role org_role;
begin
  if NEW.type in ('db_write', 'notify') then
    select org_id into v_org_id from workflows where id = NEW.workflow_id;
    select role into v_role from org_members where org_id = v_org_id and user_id = NEW.created_by;
    if v_role is distinct from 'owner' then
      raise exception 'only an org owner may create workflow_steps of type db_write or notify';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_enforce_owner_only_step_types
  before insert or update on workflow_steps
  for each row execute function enforce_owner_only_step_types();

create or replace function enforce_owner_only_trigger_types() returns trigger as $$
declare
  v_org_id uuid;
  v_role org_role;
begin
  if NEW.type = 'webhook' then
    select org_id into v_org_id from workflows where id = NEW.workflow_id;
    select role into v_role from org_members where org_id = v_org_id and user_id = NEW.created_by;
    if v_role is distinct from 'owner' then
      raise exception 'only an org owner may create workflow_triggers of type webhook';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_enforce_owner_only_trigger_types
  before insert or update on workflow_triggers
  for each row execute function enforce_owner_only_trigger_types();
