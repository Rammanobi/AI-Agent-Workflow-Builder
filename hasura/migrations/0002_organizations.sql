create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_limit integer not null default 100,
  quota_used integer not null default 0,
  created_at timestamptz not null default now()
);
