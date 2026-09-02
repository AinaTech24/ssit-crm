"use client";

/**
 * FundReturnPicker — prefill an expected-return field from a fund CATEGORY's
 * typical long-term assumption. Deliberately category-based (no specific fund
 * names): a return projection shouldn't be tied to a named scheme's past
 * performance. Naming the actual recommended schemes belongs in the
 * "Suggested schemes" field (which searches real funds from the MF API).
 */

import { useState } from "react";

/** Typical long-term return assumptions by category (illustrative, not assured). */
const CATEGORY_RETURNS: { label: string; pct: number }[] = [
  { label: "Large Cap / Bluechip", pct: 11 },
  { label: "Flexi / Multi Cap", pct: 12 },
  { label: "Mid Cap", pct: 13 },
  { label: "Small Cap", pct: 14 },
  { label: "ELSS (Tax Saver)", pct: 12 },
  { label: "Index (Nifty 50)", pct: 11 },
  { label: "Aggressive Hybrid", pct: 10 },
  { label: "Balanced Advantage", pct: 9 },
  { label: "Conservative Hybrid", pct: 8 },
  { label: "Gold", pct: 9 },
  { label: "Debt — Corporate / Short", pct: 7 },
  { label: "Liquid / Ultra-short", pct: 6 },
];

export function FundReturnPicker({ onPick }: { onPick: (pct: number) => void }) {
  const [sel, setSel] = useState("");
  const chosen = CATEGORY_RETURNS.find((c) => c.label === sel);

  return (
    <div className="space-y-1">
      <select
        value={sel}
        onChange={(e) => {
          const v = e.target.value;
          setSel(v);
          const c = CATEGORY_RETURNS.find((x) => x.label === v);
          if (c) onPick(c.pct);
        }}
        className="input-base text-sm w-full h-8"
      >
        <option value="">Prefill return from a category…</option>
        {CATEGORY_RETURNS.map((c) => (
          <option key={c.label} value={c.label}>{c.label} — {c.pct}%</option>
        ))}
      </select>
      {chosen && (
        <p className="text-[10px] text-muted-foreground">
          Typical long-term assumption for {chosen.label} ({chosen.pct}%) — illustrative, not a guarantee.
        </p>
      )}
    </div>
  );
}
