"use client";

/**
 * Cross-sell / product-holdings matrix for the Client 360 (Sanchay
 * "Cross Selling" parity). The RM marks which products the client holds
 * (with us / elsewhere), is interested in, or doesn't hold — and the card
 * surfaces the open wallet-share opportunities. Saves to the investor PATCH.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Check, TrendingUp } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import {
  CROSS_SELL_PRODUCTS,
  CROSS_SELL_COLUMN_SPLIT,
  CROSS_SELL_STATUSES,
  crossSellOpportunities,
  crossSellStatusLabel,
  crossSellStatusTone,
  type CrossSellMap,
} from "@/lib/investors/cross-sell";

export function CrossSellCard({
  investorId,
  initial,
}: {
  investorId: string;
  initial: CrossSellMap | null;
}) {
  const router = useRouter();
  const [map, setMap] = useState<CrossSellMap>(initial ?? {});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const opps = crossSellOpportunities(map);

  function setProduct(key: string, val: string) {
    setMap((m) => ({ ...m, [key]: val }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/investors/${investorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ crossSell: map }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <TrendingUp className="size-4" /> Cross-sell / holdings
        </h2>
        {opps.length > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
            {opps.length} opportunit{opps.length === 1 ? "y" : "ies"}
          </span>
        )}
      </div>

      {/* Two explicit COLUMNS, not a 2-col grid: a grid flows 1,2 / 3,4 across
          the rows, which would interleave the two lists. The firm reads this
          top-to-bottom down each side, so each side is its own stack. */}
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {[
          CROSS_SELL_PRODUCTS.slice(0, CROSS_SELL_COLUMN_SPLIT),
          CROSS_SELL_PRODUCTS.slice(CROSS_SELL_COLUMN_SPLIT),
        ].map((column, i) => (
          <div key={i} className="space-y-2">
            {column.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-sm">{label}</span>
                <SelectField
                  value={map[key] ?? ""}
                  onChange={(e) => setProduct(key, e.target.value)}
                  className="text-xs w-40"
                >
                  <option value="">Select…</option>
                  {CROSS_SELL_STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </SelectField>
              </div>
            ))}
          </div>
        ))}
      </div>

      {opps.length > 0 && (
        <div className="mt-4 pt-3 border-t">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Wallet-share opportunities
          </div>
          <div className="flex flex-wrap gap-1.5">
            {opps.map((o) => (
              <span key={o.key} className={`chip text-xs border ${crossSellStatusTone(o.status)}`}>
                {o.label} · {crossSellStatusLabel(o.status)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end mt-4 pt-3 border-t">
        {err && <span className="text-xs text-rose-600">{err}</span>}
        {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-0.5"><Check className="size-3" /> Saved</span>}
        <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save holdings
        </button>
      </div>
    </div>
  );
}
