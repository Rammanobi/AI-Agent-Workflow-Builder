"use client";

import { useState } from "react";

export type TriggerType = "manual" | "scheduled" | "webhook" | "database_event";

export interface TriggerFormValue {
  type: TriggerType;
  config: Record<string, any>;
}

export default function TriggerEditor({
  value,
  onChange,
  canEditWebhook,
}: {
  value: TriggerFormValue;
  onChange: (next: TriggerFormValue) => void;
  /** Only org owners may create/edit `webhook` triggers. */
  canEditWebhook: boolean;
}) {
  const [local, setLocal] = useState(value);

  function update(next: Partial<TriggerFormValue>) {
    const merged = { ...local, ...next };
    setLocal(merged);
    onChange(merged);
  }

  function updateConfig(key: string, val: any) {
    update({ config: { ...local.config, [key]: val } });
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <label style={{ display: "block" }}>
        Trigger type
        <select value={local.type} onChange={(e) => update({ type: e.target.value as TriggerType, config: {} })}>
          <option value="manual">manual</option>
          <option value="scheduled">scheduled</option>
          <option value="webhook" disabled={!canEditWebhook}>
            webhook (owner only)
          </option>
          <option value="database_event">database_event</option>
        </select>
      </label>

      {local.type === "scheduled" && (
        <label style={{ display: "block", marginTop: 8 }}>
          Interval (minutes)
          <input
            type="number"
            min={1}
            value={local.config.interval_minutes ?? 60}
            onChange={(e) => updateConfig("interval_minutes", Number(e.target.value))}
          />
        </label>
      )}

      {local.type === "webhook" && (
        <p style={{ fontSize: 12, color: "#666" }}>
          A dedicated inbound webhook URL would be generated per-workflow (not implemented in this scaffold's UI --
          see WRITEUP.md for the security reasoning on why this type is owner-only).
        </p>
      )}

      {local.type === "database_event" && (
        <label style={{ display: "block", marginTop: 8 }}>
          Watched table
          <input value={local.config.watched_table ?? ""} onChange={(e) => updateConfig("watched_table", e.target.value)} placeholder="step_results" />
        </label>
      )}
    </div>
  );
}
