"use client";

import { useQuery } from "@apollo/client";
import { GET_ORG_USAGE } from "@/lib/graphql";

export default function QuotaBar({ orgId }: { orgId: string }) {
  const { data, loading } = useQuery(GET_ORG_USAGE, { variables: { org_id: orgId }, skip: !orgId });

  if (loading || !data?.org_usage_this_month?.[0]) return null;

  const usage = data.org_usage_this_month[0];
  const pct = Math.min(100, Math.round((usage.quota_used / usage.quota_limit) * 100));

  return (
    <div style={{ fontSize: 13, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Quota</span>
        <span>
          {usage.quota_used}/{usage.quota_limit} runs used - {usage.runs_this_month} this month
        </span>
      </div>
      <div style={{ height: 6, background: "#eee", borderRadius: 3, marginTop: 4 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 3,
            background: pct >= 100 ? "#dc2626" : "#2563eb",
          }}
        />
      </div>
    </div>
  );
}
