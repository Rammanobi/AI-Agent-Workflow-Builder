// Server-only helper for talking to Hasura with the admin secret.
//
// This is what the Action handlers (api/trigger-workflow-run,
// api/approve-step) and webhook targets (api/notify-webhook,
// api/scheduled-trigger, api/db-event-webhook) use to read/write tables
// completely outside of any user's row permissions. It is ALSO what those
// handlers use to independently re-verify a caller's org_id + role by
// querying org_members directly -- see the big comment blocks in
// app/app/api/trigger-workflow-run/route.ts and .../approve-step/route.ts
// for why that re-check is mandatory and cannot be skipped.
//
// Never import this file into anything that runs in the browser.

const HASURA_GRAPHQL_URL =
  process.env.HASURA_GRAPHQL_GRAPHQL_URL || "http://localhost:8080/v1/graphql";
const HASURA_GRAPHQL_ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || "";

export class HasuraAdminError extends Error {
  constructor(message: string, public errors: unknown) {
    super(message);
    this.name = "HasuraAdminError";
  }
}

export async function hasuraAdminRequest<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(HASURA_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": HASURA_GRAPHQL_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new HasuraAdminError("Hasura admin request failed", json.errors);
  }
  return json.data as T;
}

export type OrgRole = "owner" | "editor" | "viewer";

export interface OrgMembership {
  org_id: string;
  role: OrgRole;
}

/**
 * Layer 2 re-check: given a user_id and an org_id, ask Postgres (via the
 * admin secret, bypassing Hasura permissions entirely) what that user's role
 * actually is in that org. This is the ONLY trustworthy source of truth
 * inside an Action handler -- forwarded x-hasura-* session variables on an
 * Action's HTTP request are set by Hasura from the caller's JWT, but nothing
 * stops a handler bug from misreading or a client from acting on stale data,
 * so the org_members table is re-queried fresh, every time.
 */
export async function getMembership(userId: string, orgId: string): Promise<OrgMembership | null> {
  const data = await hasuraAdminRequest<{ org_members: OrgMembership[] }>(
    `query GetMembership($user_id: uuid!, $org_id: uuid!) {
      org_members(where: { user_id: { _eq: $user_id }, org_id: { _eq: $org_id } }, limit: 1) {
        org_id
        role
      }
    }`,
    { user_id: userId, org_id: orgId }
  );
  return data.org_members[0] ?? null;
}

export function roleAtLeast(role: OrgRole, minimum: "viewer" | "editor" | "owner"): boolean {
  const rank: Record<OrgRole, number> = { viewer: 0, editor: 1, owner: 2 };
  return rank[role] >= rank[minimum];
}
