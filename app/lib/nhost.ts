import { NhostClient } from "@nhost/nextjs";

// Single shared nhost client for the browser (auth + GraphQL + subscriptions).
// NEXT_PUBLIC_* vars are safe to expose to the client; nhost derives the
// Hasura/Auth/Storage URLs from subdomain+region.
export const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || "localhost",
  region: process.env.NEXT_PUBLIC_NHOST_REGION || "",
});
