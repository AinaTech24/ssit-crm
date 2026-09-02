"use client";

/**
 * A concentration bar (AMC or asset-class) that expands on click to reveal the
 * investors behind it — so a risk signal becomes an action list. Lazy-fetches
 * /api/portfolio-intelligence/drill the first time it's opened.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

type Holder = { investorId: string; name: string; value: number; pct: number };

export function PortfolioDrillBar({
  by,
  label,
  pct,
  value,
  color,
  rank,
  mine,
}: {
  by: "amc" | "class";
  label: string;
  pct: number;
  value: number;
  color: string;
  rank?: number;
  mine: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && holders === null && !loading) {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ by, key: label, ...(mine ? { mine: "1" } : {}) });
        const res = await fetch(`/api/portfolio-intelligence/drill?${qs.toString()}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) setErr(j.error ?? "Could not load");
        else setHolders(j.holders ?? []);
      } catch {
        setErr("Network error");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div>
      <button type="button" onClick={toggle} className="w-full text-left group" aria-expanded={open}>
        <div className="flex items-center justify-between text-xs mb-0.5">
          <span className="font-medium truncate inline-flex items-center gap-1">
            <ChevronRight className={`size-3 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
            {rank ? `${rank}. ` : ""}{label}
          </span>
          <span className="tabular-nums text-muted-foreground">{inr(value)} · {pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      </button>
      {open && (
        <div className="mt-1.5 ml-4 pl-2 border-l border-border space-y-1">
          {loading ? (
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 py-1"><Loader2 className="size-3 animate-spin" /> Loading…</div>
          ) : err ? (
            <div className="text-[11px] text-rose-600 py-1">{err}</div>
          ) : holders && holders.length > 0 ? (
            holders.map((h) => (
              <Link key={h.investorId} href={`/dashboard/investors/${h.investorId}`} className="flex items-center justify-between text-[11px] hover:text-brand-cyan">
                <span className="truncate">{h.name}</span>
                <span className="tabular-nums text-muted-foreground">{inr(h.value)} · {h.pct}%</span>
              </Link>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground py-1">No clients found.</div>
          )}
        </div>
      )}
    </div>
  );
}
