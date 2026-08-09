"use client";

import { useState } from "react";

export type StepType = "llm_call" | "http_request" | "db_write" | "notify" | "conditional_branch" | "approval_gate";

export interface StepFormValue {
  step_order: number;
  type: StepType;
  config: Record<string, any>;
}

const STEP_TYPES: StepType[] = ["llm_call", "http_request", "db_write", "notify", "conditional_branch", "approval_gate"];

/** Renders the right config fields for a step's type and reports changes to the parent. */
export default function StepEditor({
  value,
  onChange,
  onDelete,
  canEditRestrictedTypes,
}: {
  value: StepFormValue;
  onChange: (next: StepFormValue) => void;
  onDelete: () => void;
  /** Only org owners may create/edit db_write and notify steps (Layer 1 + DB trigger enforce this too). */
  canEditRestrictedTypes: boolean;
}) {
  const [local, setLocal] = useState(value);

  function update(next: Partial<StepFormValue>) {
    const merged = { ...local, ...next };
    setLocal(merged);
    onChange(merged);
  }

  function updateConfig(key: string, val: any) {
    update({ config: { ...local.config, [key]: val } });
  }

  const restricted = local.type === "db_write" || local.type === "notify";

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Step {local.step_order}</strong>
        <button onClick={onDelete} style={{ color: "crimson" }}>
          Remove
        </button>
      </div>

      <label style={{ display: "block", marginTop: 8 }}>
        Type
        <select value={local.type} onChange={(e) => update({ type: e.target.value as StepType, config: {} })}>
          {STEP_TYPES.map((t) => (
            <option key={t} value={t} disabled={(t === "db_write" || t === "notify") && !canEditRestrictedTypes}>
              {t}
              {(t === "db_write" || t === "notify") ? " (owner only)" : ""}
            </option>
          ))}
        </select>
      </label>

      {restricted && !canEditRestrictedTypes && (
        <p style={{ color: "#d97706", fontSize: 12 }}>Only an org owner can configure db_write/notify steps.</p>
      )}

      {local.type === "llm_call" && (
        <>
          <label style={{ display: "block", marginTop: 8 }}>
            Model
            <input value={local.config.model ?? ""} onChange={(e) => updateConfig("model", e.target.value)} placeholder="llama-3.1-8b-instant" />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Prompt (use {"{{previous_output}}"} to reference the prior step)
            <textarea value={local.config.prompt ?? ""} onChange={(e) => updateConfig("prompt", e.target.value)} rows={3} style={{ width: "100%" }} />
          </label>
        </>
      )}

      {local.type === "http_request" && (
        <>
          <label style={{ display: "block", marginTop: 8 }}>
            URL
            <input value={local.config.url ?? ""} onChange={(e) => updateConfig("url", e.target.value)} placeholder="https://example.com/api" />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Method
            <select value={local.config.method ?? "GET"} onChange={(e) => updateConfig("method", e.target.value)}>
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>DELETE</option>
            </select>
          </label>
        </>
      )}

      {local.type === "db_write" && (
        <label style={{ display: "block", marginTop: 8 }}>
          Data (JSON)
          <textarea
            value={JSON.stringify(local.config.data ?? {}, null, 2)}
            onChange={(e) => {
              try {
                updateConfig("data", JSON.parse(e.target.value));
              } catch {
                /* ignore invalid JSON until it parses */
              }
            }}
            rows={4}
            style={{ width: "100%" }}
            disabled={!canEditRestrictedTypes}
          />
        </label>
      )}

      {local.type === "notify" && (
        <>
          <label style={{ display: "block", marginTop: 8 }}>
            Channel
            <input value={local.config.channel ?? ""} onChange={(e) => updateConfig("channel", e.target.value)} disabled={!canEditRestrictedTypes} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Message
            <textarea
              value={local.config.message ?? ""}
              onChange={(e) => updateConfig("message", e.target.value)}
              rows={2}
              style={{ width: "100%" }}
              disabled={!canEditRestrictedTypes}
            />
          </label>
        </>
      )}

      {local.type === "conditional_branch" && (
        <>
          <label style={{ display: "block", marginTop: 8 }}>
            Field (dot path into previous output, blank = whole output)
            <input value={local.config.field ?? ""} onChange={(e) => updateConfig("field", e.target.value)} />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Operator
            <select value={local.config.operator ?? "eq"} onChange={(e) => updateConfig("operator", e.target.value)}>
              <option value="eq">equals</option>
              <option value="neq">not equals</option>
              <option value="contains">contains</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
            </select>
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Value
            <input value={local.config.value ?? ""} onChange={(e) => updateConfig("value", e.target.value)} />
          </label>
        </>
      )}

      {local.type === "approval_gate" && (
        <label style={{ display: "block", marginTop: 8 }}>
          Approval message (shown to reviewer)
          <input value={local.config.message ?? ""} onChange={(e) => updateConfig("message", e.target.value)} />
        </label>
      )}
    </div>
  );
}
