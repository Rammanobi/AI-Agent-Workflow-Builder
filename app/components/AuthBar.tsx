"use client";

import { useAuthenticationStatus, useUserData, useSignOut, useUserDefaultRole } from "@nhost/react";

/** Shown on every page once signed in -- lets a demo/reviewer switch accounts
    without needing devtools, since there's otherwise no way to end a session. */
export default function AuthBar() {
  const { isAuthenticated } = useAuthenticationStatus();
  const user = useUserData();
  const role = useUserDefaultRole();
  const { signOut } = useSignOut();

  if (!isAuthenticated) return null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 12,
        padding: "10px 24px",
        borderBottom: "1px solid var(--border, #e2e5ea)",
        fontSize: 13,
        color: "#6b7280",
      }}
    >
      <span>
        {user?.email} {role ? `(${role})` : ""}
      </span>
      <button onClick={() => signOut()} style={{ padding: "4px 12px" }}>
        Sign out
      </button>
    </div>
  );
}
