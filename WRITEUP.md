# Design Writeup

## Schema reasoning

The schema separates **structure** from **execution**, and separates **who
can define things** from **who can run/approve things**.

- `organizations` / `org_members` — a plain multi-tenant join table with a
  `role` enum (`owner`/`editor`/`viewer`). This is deliberately the *only*
  place role is stored; every permission check (Hasura row permission,
  Action-handler re-check, Postgres trigger) reads this same table instead of
  duplicating role logic, so there is exactly one place to get it right.
- `workflows` → `workflow_steps` / `workflow_triggers` describe *what a
  workflow does* and *what starts it*, edited by owners/editors. `step_order`
  plus a unique `(workflow_id, step_order)` constraint gives a simple,
  gap-tolerant ordering without a linked list.
- `workflow_runs` → `step_runs` describe *what actually happened*, and are
  never written by end users directly — only by the shared executor via the
  admin client. This split means a workflow's definition can be edited freely
  without ever touching historical run records, and run history is
  append-only/immutable from the client's point of view (no update/delete
  permission is granted to any role on either table).
- `step_results` and `notifications` are execution *side effects* of specific
  step types (`db_write`, `notify`), kept as separate tables rather than
  overloading `step_runs.output` — this is also what lets a Hasura Event
  Trigger watch a narrow, single-purpose table instead of firing on every
  step_run mutation.
- `org_usage_this_month` is a VIEW, not a materialized/cached counter, because
  quota display should always reflect the current `quota_used` counter plus a
  live count of this month's runs — recomputing it is cheap at this scale and
  avoids a second place quota can drift out of sync.
- The Postgres trigger in `0011_enforcement_triggers.sql` requires
  `created_by` on `workflow_steps`/`workflow_triggers` specifically so it can
  check the creator's role without depending on any session variable being
  set — it works identically whether the row was inserted through Hasura,
  the admin API, or a future migration script.

## How org_id/role actually get into the JWT

Everything in Layer 1 depends on `x-hasura-org-id` and `x-hasura-default-role`
being correct in the caller's JWT — but nhost's default session for any signed-up
user only carries the generic system roles `user`/`me`, with no notion of an
organization at all. Getting the real values in requires three pieces working
together, none of which is optional:

1. **Two relationships on `auth.users`** (nhost's own managed table), added via
   the Hasura API: an object relationship `orgMembership` and an array
   relationship `orgMemberships`, both manually mapped to `public.org_members`
   on `auth.users.id = org_members.user_id`. These exist purely so nhost's
   claim-resolution can walk from "the signed-in user" to "their org row" —
   see `hasura/metadata/databases/default/tables/auth_users.yaml` (kept as
   reference documentation only; the live project tracks many more
   nhost-managed `auth.*` tables than this repo's metadata folder represents,
   so this file is intentionally not part of what `hasura metadata apply`
   reapplies).
2. **Custom JWT claims**, configured on the nhost project itself (Settings →
   Configuration Editor, not a file in this repo, since it's nhost-platform
   config rather than Hasura metadata):
   ```toml
   [auth.session.accessToken]
   customClaims = [
     { key = "org-id", value = "orgMembership.org_id" },
     { key = "default-role", value = "orgMembership.role" },
     { key = "allowed-roles", value = "orgMemberships[].role" },
   ]
   ```
   These resolve at token-issuance time via the relationships above and land
   in the JWT as `x-hasura-org-id` / `x-hasura-default-role` /
   `x-hasura-allowed-roles` — the exact session variables Layer 1's row
   permissions filter on.
3. **Project-wide allowed roles**, seeded once by adding `owner`/`editor`/
   `viewer` to `[auth.user.roles].allowed` in the same nhost config —
   `default-role`/`allowed-roles` are *reserved* Hasura claim names, and
   nhost only honors a resolved value if it's also in this allowed-roles
   list. Doing this once, project-wide, has a side effect worth knowing:
   nhost automatically grants **every** allowed role (`user`, `me`, `owner`,
   `editor`, `viewer`) to **every** signup in `auth.user_roles` — there is no
   per-user role-grant step. The only per-user step actually needed is
   setting `auth.users.default_role` to match their `org_members.role`
   (`update auth.users set default_role = 'owner' where id = ...`), done by
   hand via SQL whenever a user is added to `org_members`, since there's no
   self-serve onboarding UI yet (see README's "Known limitations").

One caveat worth flagging: `orgMembership` is an *object* relationship, so if
a user is ever added to a second organization, which `org_members` row it
resolves for `org-id`/`default-role` becomes whichever row Hasura happens to
pick — not deterministic. This project's demo assumes one org per user, which
holds for every seeded test account; supporting real multi-org membership
would need an explicit "active org" selector that reissues the token, not a
bigger customClaims path.

## The two permission layers, and how they differ

**Layer 1 — Hasura row permissions** (`hasura/metadata/databases/default/tables/*.yaml`).
Every `select`/`insert`/`update`/`delete` permission, for every role, filters
on `org_id: { _eq: "X-Hasura-Org-Id" }` (directly, or through a relationship
for tables that don't carry `org_id` themselves, like `workflow_steps`). This
is enforced by Hasura's query planner as part of the SQL it generates — a
client cannot bypass it by crafting a clever `where` clause, because the
filter is *injected*, not client-supplied. This is what makes an org's data
invisible even if another org's row UUID leaks. Column-level restrictions
(editors cannot insert/update `db_write`/`notify` steps or `webhook`
triggers) live here too, as an additional predicate on the `check`/`filter`.

**Layer 2 — Action-handler re-verification** (`app/app/api/trigger-workflow-run/route.ts`,
`app/app/api/approve-step/route.ts`). Hasura **Actions** are a deliberate
escape hatch from row permissions: Hasura forwards session variables as HTTP
headers to a webhook and trusts the webhook to do the right thing — it does
**not** re-run Layer 1 on the Action's behalf, and the `permissions:` block
in `actions.yaml` only gates *which roles may call the action at all*
(coarse), not whether the specific `workflow_id`/`step_run_id` in the request
belongs to the caller's org (fine-grained). If either handler trusted the
forwarded `x-hasura-org-id` at face value, a malicious client could invoke the
Action directly against Hasura's GraphQL endpoint with a forged org id and
run/approve steps in an org it doesn't belong to.

So both handlers do the same thing before touching anything: resolve the
*true* org from the resource itself (`workflow_id` → `workflows.org_id`, or
`step_run_id` → `workflow_run.org_id`) using the admin secret, then query
`org_members` for `(that true org, x-hasura-user-id)` and check the role is
sufficient. Only after that independent check passes does execution proceed.
This is the layer most commonly skipped in Hasura+Actions designs, because it
"looks like" the row permissions should already cover it — they don't, by
design, for anything that isn't a plain table mutation.

## Approval-gate pause/resume mechanics

An `approval_gate` step is not special-cased in the data model — it is a
`step_runs` row like any other, with `status`. What's special is *how it
resumes*:

1. `executeFromStep` (the shared engine, `app/lib/workflow-executor.ts`) runs
   steps in `step_order`. When it reaches an `approval_gate` step, it sets
   that `step_runs.status = 'paused'` and the parent `workflow_runs.status =
   'paused'`, then **returns immediately** — no further steps run in this
   invocation.
2. The only sanctioned way to continue is the `approveStep` Action. Its
   handler independently re-checks the approver's role (Layer 2, above),
   and only if that passes does it mark the step_run `completed` with
   `approved_by`/`approved_at`, then call `executeFromStep(workflowRunId,
   pausedStepOrder + 1)` — the *same* function `trigger-workflow-run` used to
   start the run in the first place, just given a later starting point.
3. Nothing else can resume a paused run. No Hasura role has `update`
   permission on `step_runs` (see `step_runs.yaml`), so a plain GraphQL
   mutation cannot flip the status — even an owner has to go through the
   Action, and the Action re-checks role independently of whatever Hasura
   already decided. This closes the gap where "the UI only shows the Approve
   button to owners/editors" would otherwise be a purely cosmetic
   restriction.
