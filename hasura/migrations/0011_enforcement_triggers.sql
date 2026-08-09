-- Defense-in-depth: only an 'owner' may create restricted step/trigger types.
-- This is enforced at the database layer IN ADDITION to the Hasura column
-- presets/permission check and the Action-handler role check, so the rule
-- holds even if metadata is misconfigured or a caller has the admin secret.
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
