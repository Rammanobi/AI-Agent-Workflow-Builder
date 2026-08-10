"use client";

import type { ReactNode } from "react";
import { NhostProvider } from "@nhost/nextjs";
import { NhostApolloProvider } from "@nhost/react-apollo";
import { nhost } from "@/lib/nhost";
import AuthBar from "@/components/AuthBar";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <NhostApolloProvider nhost={nhost}>
        <AuthBar />
        {children}
      </NhostApolloProvider>
    </NhostProvider>
  );
}
