"use client";

/**
 * ProductInterestDialog — opens when an RM clicks "Qualified — Won Lead".
 *
 * Captures which product(s) the client is investing in and the PRIMARY product,
 * which decides the onboarding branch (Mutual Funds → MF onboarding; Insurance →
 * the insurance journey). Posts to /api/leads/[id]/won which records the choice,
 * sets the pipeline and advances the blueprint to Won Lead.
 */

import { useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { LEAD_PRODUCTS } from "@/lib/blueprints/lead_to_client";

export function ProductInterestDialog({
  leadId,
  leadName,
  onClose,
  onDone,
}: {
  leadId: string;
  leadName?: string;
  onClose: () => void;
  onDone: (pipeline: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(["mutual_funds"]);
  const [primary, setPrimary] = useState<string>("mutual_funds");
  const [basis, setBasis] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryMeta = useMemo(() => LEAD_PRODUCTS.find((p) => p.value === primary), [primary]);

  function toggle(value: string) {
    setSelected((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      // Keep `primary` valid: if it was removed, fall back to the first selected.
      if (!next.includes(primary)) setPrimary(next[0] ?? "");
      else if (prev.length === 0 && next.length === 1) setPrimary(next[0]);
      return next;
    });
  }

  async function save() {
    if (selected.length === 0) {
      setError("Pick at least one product.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Fold the qualification basis into the won notes so it's captured for
      // win/loss reporting without a schema change.
      const composedNotes =
        [basis ? `Qualified via: ${basis}` : "", notes.trim()].filter(Boolean).join(" — ") || undefined;
      const res = await fetch(`/api/leads/${leadId}/won`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: selected, primaryProduct: primary || selected[0], notes: composedNotes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Failed to save");
      onDone(d.pipeline ?? "mf");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-foreground" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Sparkles className="size-5 text-emerald-600" />
          <h3 className="font-bold text-base">Won Lead — what is {leadName ? leadName : "the client"} investing in?</h3>
        </div>

        <p className="text-xs text-muted-foreground">
          Pick the product(s) the client wants. The <strong>primary</strong> product decides the onboarding flow that opens next.
        </p>

        {/* Product multi-select */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Products of interest</div>
          <div className="flex flex-wrap gap-2">
            {LEAD_PRODUCTS.map((p) => {
              const on = selected.includes(p.value);
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => toggle(p.value)}
                  className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${
                    on ? "bg-emerald-600 text-white border-emerald-600" : "bg-card border-border hover:border-emerald-400"
                  }`}
                >
                  {on && <CheckCircle2 className="size-3.5 inline mr-1 -mt-0.5" />}
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary product */}
        {selected.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Primary product (drives the flow)</div>
            <div className="flex flex-wrap gap-3">
              {selected.map((v) => {
                const meta = LEAD_PRODUCTS.find((p) => p.value === v);
                return (
                  <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" checked={primary === v} onChange={() => setPrimary(v)} />
                    {meta?.label ?? v}
                  </label>
                );
              })}
            </div>
            {primaryMeta && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Next:{" "}
                <strong>
                  {primaryMeta.pipeline === "insurance"
                    ? "Insurance onboarding (needs analysis → quote → proposal → underwriting → policy)"
                    : "Client onboarding (request documents → KYC → UCC → mandate → first investment)"}
                </strong>
                .
              </p>
            )}
          </div>
        )}

        {/* Qualification basis — how the lead was qualified (for win analytics). */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">How was this lead qualified?</div>
          <select value={basis} onChange={(e) => setBasis(e.target.value)} className="input-base text-sm w-full">
            <option value="">— optional —</option>
            <option value="Met in person">Met in person</option>
            <option value="Phone-qualified">Phone-qualified</option>
            <option value="Referral — warm intro">Referral — warm intro</option>
            <option value="Existing relationship">Existing relationship</option>
            <option value="Online / self-serve">Online / self-serve</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Notes */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. interested in term + ELSS; budget ₹25k/mo"
            className="input-base text-sm w-full"
          />
        </div>

        {error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start gap-1.5">
            <AlertTriangle className="size-3.5 mt-0.5" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={saving || selected.length === 0}
            className="btn-primary text-sm !bg-emerald-600 hover:!bg-emerald-700 text-white font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Confirm &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
