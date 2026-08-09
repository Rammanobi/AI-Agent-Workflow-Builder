import type { ReactNode } from "react";
import { NhostProvider } from "@nhost/nextjs";
import { NhostApolloProvider } from "@nhost/react-apollo";
import { nhost } from "@/lib/nhost";

export const metadata = {
  title: "AI Agent Workflow Builder",
  description: "Chain AI-agent steps into workflows -- a mini n8n.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostProvider nhost={nhost}>
          <NhostApolloProvider nhost={nhost}>{children}</NhostApolloProvider>
        </NhostProvider>
      </body>
    </html>
  );
}
