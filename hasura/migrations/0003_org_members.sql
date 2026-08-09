-- org_members is the single source of truth for role checks: both Hasura row
-- permissions (X-Hasura-Org-Id + X-Hasura-Role) and the Action-handler code
-- (server-side re-check via admin secret) key off this table.
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_members_org_id on org_members(org_id);
create index idx_org_members_user_id on org_members(user_id);
