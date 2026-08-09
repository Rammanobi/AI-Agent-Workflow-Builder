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
