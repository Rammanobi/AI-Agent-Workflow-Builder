"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@apollo/client";
import { useAuthenticationStatus, useUserData, useHasuraClaim, useUserDefaultRole } from "@nhost/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CREATE_WORKFLOW, GET_ORG_WORKFLOWS } from "@/lib/graphql";
import RunStatusBadge from "@/components/RunStatusBadge";
import QuotaBar from "@/components/QuotaBar";

export default function WorkflowsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const user = useUserData();
  const router = useRouter();
  const [name, setName] = useState("");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace("/login");
  }, [authLoading, isAuthenticated, router]);

  const { data, loading, error, refetch } = useQuery(GET_ORG_WORKFLOWS, { skip: !isAuthenticated });
  const [createWorkflow, { loading: creating }] = useMutation(CREATE_WORKFLOW);

  // The current org is derived from the x-hasura-org-id JWT claim, which
  // nhost injects via a custom claim (see nhost auth config: [[auth.session
  // .accessToken.customClaims]]) resolved off the auth.users -> org_members
  // relationship -- it is not something the client chooses.
  const orgId = useHasuraClaim("org-id");
  const role = useUserDefaultRole();
  const isViewer = role === "viewer";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !orgId) return;
    await createWorkflow({ variables: { org_id: orgId, name, description: "", created_by: user.id } });
    setName("");
    refetch();
  }

  if (authLoading || loading) return <p style={{ padding: 24 }}>Loading...</p>;
  if (error) return <p style={{ padding: 24, color: "crimson" }}>{error.message}</p>;

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Workflows</h1>
      {orgId && <QuotaBar orgId={Array.isArray(orgId) ? orgId[0] : orgId} />}

      {!isViewer && (
        <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input placeholder="New workflow name" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit" disabled={creating}>
            Create
          </button>
        </form>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {data?.workflows?.map((wf: any) => (
          <li key={wf.id} className="card" style={{ listStyle: "none" }}>
            <Link href={`/workflows/${wf.id}`} style={{ fontWeight: 600 }}>
              {wf.name}
            </Link>
            <div style={{ fontSize: 12, color: "#666" }}>
              {wf.steps.length} steps - {wf.triggers.length} triggers
            </div>
            {wf.runs[0] && (
              <div style={{ marginTop: 4 }}>
                Last run: <RunStatusBadge status={wf.runs[0].status} />
              </div>
            )}
          </li>
        ))}
        {data?.workflows?.length === 0 && <p>No workflows yet. Create one above.</p>}
      </ul>
    </main>
  );
}
