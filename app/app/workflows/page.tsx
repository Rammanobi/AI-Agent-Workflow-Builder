"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@apollo/client";
import { useAuthenticationStatus, useUserData } from "@nhost/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CREATE_WORKFLOW, GET_ORG_WORKFLOWS } from "@/lib/graphql";
import RunStatusBadge from "@/components/RunStatusBadge";

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

  // The current org is derived from the X-Hasura-Org-Id session variable that
  // nhost attaches to this user's JWT (set via a custom claim at signup /
  // org-invite time); it is not something the client chooses. For this
  // scaffold we read it back off the user's active metadata claim.
  const orgId = (user?.metadata as any)?.orgId ?? (user?.defaultRole ? undefined : undefined);

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

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input placeholder="New workflow name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={creating}>
          Create
        </button>
      </form>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {data?.workflows?.map((wf: any) => (
          <li key={wf.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8 }}>
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
