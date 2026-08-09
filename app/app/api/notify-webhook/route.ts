import { NextRequest, NextResponse } from "next/server";
import { hasuraAdminRequest } from "@/lib/hasura-admin";

// Target of the Hasura Event Trigger `notify_on_insert` defined in
// hasura/metadata/databases/default/tables/notifications.yaml. Hasura calls
// this on every INSERT into `notifications` (created by a `notify` workflow
// step in lib/workflow-executor.ts). We verify the shared secret Hasura sends
// back, then deliver the message: a real Slack webhook call if
// SLACK_WEBHOOK_URL is configured, otherwise a clearly-marked simulated log
// line -- no Slack workspace/webhook exists for this assignment yet.

function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.HASURA_EVENT_WEBHOOK_SECRET || "";
  return req.headers.get("x-webhook-secret") === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ message: "invalid webhook secret" }, { status: 401 });
  }

  const body = await req.json();
  const row = body?.event?.data?.new;
  if (!row) {
    return NextResponse.json({ message: "no row in event payload" }, { status: 400 });
  }

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const message = row.payload?.message ?? "(no message)";

  if (slackWebhookUrl) {
    const res = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      console.error(`[notify-webhook] Slack delivery failed: ${res.status} ${await res.text()}`);
    }
  } else {
    // SLACK_WEBHOOK_URL not set -- this is a simulated delivery, clearly
    // marked so it is never mistaken for a real Slack message.
    console.log(`[SIMULATED SLACK MESSAGE] channel=${row.payload?.channel ?? "default"} message="${message}"`);
  }

  await hasuraAdminRequest(
    `mutation MarkNotificationSent($id: uuid!) {
      update_notifications_by_pk(pk_columns: { id: $id }, _set: { sent: true }) { id }
    }`,
    { id: row.id }
  );

  return NextResponse.json({ ok: true });
}
