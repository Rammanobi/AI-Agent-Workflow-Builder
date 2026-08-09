"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignInEmailPassword, useSignUpEmailPassword, useAuthenticationStatus } from "@nhost/react";
import { useEffect } from "react";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const { isAuthenticated } = useAuthenticationStatus();

  const { signInEmailPassword, isLoading: signInLoading, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signUpLoading, error: signUpError } = useSignUpEmailPassword();

  useEffect(() => {
    if (isAuthenticated) router.replace("/workflows");
  }, [isAuthenticated, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signin") {
      await signInEmailPassword(email, password);
    } else {
      await signUpEmailPassword(email, password);
    }
  }

  const error = mode === "signin" ? signInError : signUpError;
  const loading = mode === "signin" ? signInLoading : signUpLoading;

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1>AI Agent Workflow Builder</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode("signin")} disabled={mode === "signin"}>
          Sign in
        </button>
        <button onClick={() => setMode("signup")} disabled={mode === "signup"}>
          Sign up
        </button>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        {error && <p style={{ color: "crimson" }}>{error.message}</p>}
      </form>
      <p style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        After signing up, an org owner must add you to an organization via the <code>org_members</code> table
        before you can see any workflows (see README.md).
      </p>
    </main>
  );
}
