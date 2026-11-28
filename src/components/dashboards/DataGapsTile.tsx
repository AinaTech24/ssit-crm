"use client";

/**
 * Data Gaps tile — shows up on the Owner Cockpit. Calls
 * /api/reports/data-hygiene and renders a chip per missing field with
 * a count + click-through to the filtered Clients list. Solves the
 * "PAN / mobile / email / DOB / nominee missing report" line items
 * from the MFD ops framework in one card.
 *
 * Renders nothing if there are no gaps (clean tenant = clean dashboard).
 *
 * Fetches client-side so the cockpit page render isn't blocked by an
 * 8-aggregate query against a 100K-row table. Shows a small skeleton
 * while loading; surfaces total + each gap as a chip.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronRight,
  ShieldAlert,
  Database,
  ArrowUpRight,
} from "lucide-react";

type Gap = {
  key: string;
  label: string;
  count: number;
  href: string;
  severity: "high" | "medium";
};

export function DataGapsTile() {
  const [data, setData] = useState<{ total: number; gaps: Gap[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/data-hygiene")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message ?? "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="card-surface p-4 border-rose-200 bg-rose-50/40">
        <div className="text-xs text-rose-700 flex items-center gap-1.5">
          <AlertCircle className="size-3.5" /> Couldn't load data hygiene scan: {err}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-surface p-4">
        <div className="text-xs text-muted-foreground animate-pulse">
          Scanning client master for missing fields…
        </div>
      </div>
    );
  }

  // Clean tenant — nothing to show.
  if (data.gaps.length === 0) {
    return (
      <div className="card-surface p-4 border-emerald-200 bg-emerald-50/30">
        <div className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-emerald-700" />
          <span className="font-medium text-emerald-900">All client records are complete</span>
          <span className="text-xs text-emerald-700/80 ml-1">
            · {data.total.toLocaleString("en-IN")} clients scanned
          </span>
        </div>
      </div>
    );
  }

  const totalGaps = data.gaps.reduce((s, g) => s + g.count, 0);
  const highSev = data.gaps.filter((g) => g.severity === "high");
  const medSev = data.gaps.filter((g) => g.severity === "medium");

  return (
    <div className="card-surface p-4 space-y-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="size-9 rounded-lg bg-amber-50 border border-amber-200 grid place-items-center flex-shrink-0">
            <ShieldAlert className="size-4 text-amber-700" />
          </div>
          <div>
            <div className="text-sm font-semibold">Client master — data gaps</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {totalGaps.toLocaleString("en-IN")} fixes across {data.total.toLocaleString("en-IN")} clients.
              Click a chip to see those clients.
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/investors"
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          All clients <ArrowUpRight className="size-3" />
        </Link>
      </div>

      {highSev.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 mb-1.5">
            Compliance-impacting
          </div>
          <div className="flex flex-wrap gap-2">
            {highSev.map((g) => (
              <GapChip key={g.key} gap={g} tone="rose" />
            ))}
          </div>
        </div>
      )}

      {medSev.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1.5">
            Engagement-impacting
          </div>
          <div className="flex flex-wrap gap-2">
            {medSev.map((g) => (
              <GapChip key={g.key} gap={g} tone="amber" />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function GapChip({ gap, tone }: { gap: Gap; tone: "rose" | "amber" }) {
  const cls =
    tone === "rose"
      ? "border-rose-200 bg-rose-50/60 text-rose-900 hover:bg-rose-100 dark:border-rose-950/40 dark:bg-rose-950/20 dark:text-rose-200"
      : "border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100 dark:border-amber-950/40 dark:bg-amber-950/20 dark:text-amber-200";

  return (
    <Link
      href={gap.href}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs shadow-sm ${cls} transition-colors`}
    >
      <span className="font-semibold">{gap.label}</span>
      <span className="tabular-nums font-bold opacity-80">{gap.count.toLocaleString("en-IN")}</span>
      <ChevronRight className="size-3 opacity-40" />
    </Link>
  );
}
