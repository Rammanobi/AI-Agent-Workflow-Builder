"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthenticationStatus } from "@nhost/react";

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? "/workflows" : "/login");
  }, [isLoading, isAuthenticated, router]);

  return <p style={{ padding: 24 }}>Loading...</p>;
}
