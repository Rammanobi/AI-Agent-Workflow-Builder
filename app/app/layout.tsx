import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "AI Agent Workflow Builder",
  description: "Chain AI-agent steps into workflows -- a mini n8n.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
