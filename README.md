# AI Agent Workflow Builder

A minimal "mini n8n" for chaining AI-agent steps (`llm_call`, `http_request`, `db_write`,
`notify`, `conditional_branch`, `approval_gate`) into ordered workflows, with
multi-org access control, quotas, and human-in-the-loop approval gates.

Stack: **nhost** (Postgres + Hasura GraphQL Engine + Auth) + **Next.js 14** (App Router,
TypeScript) frontend, deployed separately (e.g. Vercel).

## What's stubbed, and why

This repo was built with **no live nhost project and no Groq API key** — those
credentials don't exist yet for this assignment. Concretely:

- **`hasura/` and `nhost/`** contain complete, portable migrations + metadata.
  Nothing here was applied to a live Hasura instance; it's written to apply
  cleanly the moment someone runs `nhost up` (or points `hasura metadata apply`
  / `hasura migrate apply` at a real instance) with real env vars.
- **`llm_call` steps** (`app/lib/workflow-executor.ts`, `executeLlmCall`) call
  Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`)
  for real when `GROQ_API_KEY` is set. When it is **not** set, the function
  short-circuits to a deterministic stubbed completion after an artificial
  **1.5 second delay** (so the "running" state is visibly real in the UI during
  a demo) — this is called out again in a comment directly above the function.
- **`notify` steps** deliver to Slack for real if `SLACK_WEBHOOK_URL` is set;
  otherwise `app/app/api/notify-webhook/route.ts` logs a message to the
  console clearly prefixed `[SIMULATED SLACK MESSAGE]`.
- Nothing else is stubbed: `http_request`, `db_write`, `conditional_branch`,
  and `approval_gate` are fully implemented against real Postgres tables via
  Hasura's admin GraphQL API.

## Env vars needed (see `app/.env.example`)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_NHOST_SUBDOMAIN`, `NEXT_PUBLIC_NHOST_REGION` | nhost project the browser auth/GraphQL client connects to |
| `HASURA_GRAPHQL_ADMIN_SECRET` | server-only; lets API routes bypass row permissions for privileged reads/writes and role re-checks |
| `HASURA_GRAPHQL_GRAPHQL_URL` | the Hasura GraphQL endpoint the admin client posts to |
| `ACTION_WEBHOOK_SECRET` | shared secret Hasura Actions send back; routes reject requests without it |
| `EVENT_WEBHOOK_SECRET` | shared secret for Event Triggers + cron trigger |
| `ACTION_BASE_URL` | this app's deployed URL, so Hasura metadata knows where to call |
| `GROQ_API_KEY` | optional — enables real `llm_call` steps |
| `SLACK_WEBHOOK_URL` | optional — enables real `notify` delivery |

## Local run instructions (once credentials exist)

1. Create an nhost project (`nhost.io` — free tier is enough), grab
   `NHOST_SUBDOMAIN` / `NHOST_REGION` and the admin secret.
2. From the repo root: `cd nhost && nhost up` (applies `hasura/migrations` and
   `hasura/metadata` automatically), or manually:
   ```
   hasura migrate apply --database-name default --skip-update-check
   hasura metadata apply
   ```
3. Insert a row into `organizations`, then one into `org_members` linking your
   nhost auth user to it with `role = 'owner'` — there is no self-serve org
   creation UI in this scaffold (out of scope for the assignment).
4. `cd app && npm install && cp .env.example .env.local` and fill in the
   values from steps 1–3.
5. `npm run dev`, then visit `http://localhost:3000`, sign up/sign in, and
   build a workflow at `/workflows`.
6. For Actions/Event Triggers/cron to reach your local app, tunnel it (e.g.
   `ngrok http 3000`) and set `ACTION_BASE_URL` to the tunnel URL, then
   `hasura metadata apply` again so the webhook URLs pick it up.

## Architecture at a glance

- **Two permission layers** — Hasura row permissions (`hasura/metadata/.../tables/*.yaml`)
  filter every table by `org_id` via the `X-Hasura-Org-Id` session variable, for
  every role. Hasura **Actions** (`triggerWorkflowRun`, `approveStep`) bypass
  those permissions entirely, so their handlers
  (`app/app/api/trigger-workflow-run/route.ts`, `app/app/api/approve-step/route.ts`)
  independently re-verify the caller's org + role against `org_members` using
  the admin secret. See `WRITEUP.md` for the full reasoning.
- **Shared executor** — `app/lib/workflow-executor.ts` is the one place steps
  actually run; both the initial trigger and an approval-driven resume call
  `executeFromStep`.
- **Defense in depth** — a Postgres trigger (`hasura/migrations/0011_enforcement_triggers.sql`)
  independently enforces that only `owner`-role users can create
  `db_write`/`notify` steps or `webhook` triggers, mirroring the Hasura-level
  column check.
