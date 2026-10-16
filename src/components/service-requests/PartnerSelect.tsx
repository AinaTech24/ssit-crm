"use client";

/**
 * Partner dropdown for a service request, with the list managed in place.
 *
 * The partners a firm raises queries with change over time, so the list is not
 * hard-coded: pick from the dropdown, or open "Add / remove partners" to grow or
 * trim it without leaving the form. Removing a partner only takes it off the
 * list — tickets already raised keep the name they were saved with.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Settings2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

type Partner = { key: string; label: string };

export function PartnerSelect({
  value,
  onChange,
}: {
  /** Selected partner NAME ("" for none). */
  value: string;
  onChange: (name: string) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/service-request-partners", { cache: "no-store" });
      const j = r.ok ? await r.json() : { partners: [] };
      setPartners(j.partners ?? []);
    } catch {
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const label = draft.trim();
    if (label.length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/service-request-partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `Could not add (${r.status})`);
        return;
      }
      setDraft("");
      await load();
      onChange(j.partner?.label ?? label);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Partner) {
    if (!window.confirm(`Remove "${p.label}" from the partner list?`)) return;
    setErr(null);
    try {
      const r = await fetch(`/api/service-request-partners?key=${encodeURIComponent(p.key)}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Could not remove (${r.status})`);
        return;
      }
      if (value === p.label) onChange("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    }
  }

  // A partner saved on an older ticket may no longer be on the list; keep it
  // selectable so the form does not silently blank it.
  const hasValue = !value || partners.some((p) => p.label === value);

  return (
    <div className="space-y-1.5">
      <SelectField value={value} onChange={(e) => onChange(e.target.value)} className="w-full" searchable>
        <option value="">{loading ? "Loading partners…" : "Select partner…"}</option>
        {!hasValue && <option value={value}>{value}</option>}
        {partners.map((p) => (
          <option key={p.key} value={p.label}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <button
        type="button"
        onClick={() => setManage((m) => !m)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        <Settings2 className="size-3" /> {manage ? "Done" : "Add / remove partners"}
      </button>
      {manage && (
        <div className="rounded-md border bg-secondary/20 p-2.5 space-y-2">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="New partner name"
              className="flex-1 border rounded-md px-2.5 py-1.5 text-sm bg-background"
            />
            <button
              type="button"
              disabled={busy || draft.trim().length < 2}
              onClick={() => void add()}
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
            </button>
          </div>
          {partners.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">No partners yet — add the first one above.</div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {partners.map((p) => (
                <li key={p.key} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs">
                  {p.label}
                  <button
                    type="button"
                    title={`Remove ${p.label}`}
                    onClick={() => void remove(p)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {err && <div className="text-[11px] text-rose-600">{err}</div>}
        </div>
      )}
    </div>
  );
}
