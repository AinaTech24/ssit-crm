"use client";

/**
 * Inline field editor for the Client 360 master record. Renders a value that,
 * on click, turns into the right control (text / email / tel / date / select),
 * PATCHes just that one field to /api/investors/[id], then refreshes so any
 * computed fields (health, review dates) re-derive. Read-only fields keep using
 * plain <KV>; the full multi-step drawer (MasterRecordEditor) still exists for
 * bulk edits — this is the "click any field, edit here" affordance.
 *
 * Nullability matters: the PATCH zod schema rejects null on non-nullable string
 * enums, so `spec.nullable` controls whether an empty value clears (→ null) or
 * is disallowed. Enum selects only show a "clear" option when nullable.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2 } from "lucide-react";

export type InlineEditSpec = {
  /** Investor id. */
  id: string;
  /** PATCH key (e.g. "phone", "segmentTag", or "address" for an address sub-field). */
  field: string;
  type?: "text" | "email" | "tel" | "date" | "select";
  /** Options for a select, value = the stored enum, label = what's shown. */
  options?: { value: string; label: string }[];
  /** Raw current value for the editor (enum key / ISO date / plain text). */
  value?: string;
  /** When set, the field is a sub-key of the `address` JSON object. */
  addressKey?: "line1" | "city" | "state" | "pincode" | "country";
  /** The current full address object, merged with the edited sub-key on save. */
  address?: Record<string, any>;
  /** True when the column accepts null — empty then clears; otherwise empty is "". */
  nullable?: boolean;
  placeholder?: string;
  maxLength?: number;
};

export function InlineEditField({ spec, display }: { spec: InlineEditSpec; display: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(spec.value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localDisplay, setLocalDisplay] = useState<string | null>(null);

  const shown = localDisplay ?? display;
  const empty = !shown || !shown.trim() || shown.trim() === "—";

  async function commit(nextRaw: string) {
    if (busy) return;
    const next = nextRaw.trim();
    if (next === (spec.value ?? "").trim()) { setEditing(false); return; }

    let body: any;
    if (spec.addressKey) {
      body = { address: { ...(spec.address ?? {}), [spec.addressKey]: next || undefined } };
    } else if (next === "") {
      if (spec.nullable) body = { [spec.field]: null };
      else if (spec.type === "select") { setEditing(false); return; } // can't clear a required enum
      else body = { [spec.field]: "" };
    } else {
      body = { [spec.field]: next };
    }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/investors/${spec.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      // Optimistic local display; refresh syncs computed fields from the server.
      const disp = spec.type === "select" ? (spec.options?.find((o) => o.value === next)?.label ?? next) : next;
      setLocalDisplay(disp || "—");
      setEditing(false);
      router.refresh();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setVal(spec.value ?? ""); setErr(null); setEditing(true); }}
        className="group/edit inline-flex items-center gap-1 text-left rounded -mx-1 px-1 hover:bg-secondary/60 transition-colors"
        title="Click to edit"
      >
        <span className={empty ? "text-muted-foreground/40 italic" : ""}>{empty ? "Add" : shown}</span>
        <Pencil className="size-3 shrink-0 opacity-0 group-hover/edit:opacity-50 transition-opacity" />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {spec.type === "select" ? (
        <select
          autoFocus
          disabled={busy}
          value={val}
          onChange={(e) => { setVal(e.target.value); void commit(e.target.value); }}
          className="rounded border border-border bg-background px-1.5 h-7 text-sm focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
        >
          {(spec.nullable || !(spec.options ?? []).some((o) => o.value === "")) && <option value="">Select…</option>}
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          autoFocus
          disabled={busy}
          type={spec.type === "date" ? "date" : spec.type === "email" ? "email" : spec.type === "tel" ? "tel" : "text"}
          value={val}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit(val); }
            if (e.key === "Escape") { setEditing(false); setErr(null); }
          }}
          className="rounded border border-border bg-background px-2 h-7 text-sm w-full max-w-[15rem] focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
        />
      )}
      {spec.type !== "select" && (
        <>
          <button type="button" onClick={() => void commit(val)} disabled={busy} className="text-emerald-600 p-0.5 hover:bg-emerald-50 rounded" title="Save">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </button>
          <button type="button" onClick={() => { setEditing(false); setErr(null); }} disabled={busy} className="text-muted-foreground p-0.5 hover:bg-secondary rounded" title="Cancel">
            <X className="size-3.5" />
          </button>
        </>
      )}
      {busy && spec.type === "select" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {err && <span className="text-[11px] text-rose-600 w-full">{err}</span>}
    </span>
  );
}
