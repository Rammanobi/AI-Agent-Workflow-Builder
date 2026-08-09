-- Extensions and enum types shared across the schema.
create extension if not exists pgcrypto;

create type org_role as enum ('owner', 'editor', 'viewer');
create type step_type as enum ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate');
create type trigger_type as enum ('manual', 'scheduled', 'webhook', 'database_event');
create type run_status as enum ('pending', 'running', 'paused', 'completed', 'failed');
