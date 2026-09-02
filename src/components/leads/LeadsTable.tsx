"use client";

/**
 * Leads table view with row selection + bulk actions + a sortable priority
 * Score column. Supports compact vs cozy table density and split-screen
 * side-peek drawer for rapid lead inspections.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  Eye,
} from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { formatINR, formatDate } from "@/lib/utils";
import { leadScoreBand } from "@/lib/leads/scoring";
import { Avatar } from "@/components/ui/Avatar";
import { TableDensityToggle, useTableDensity } from "@/components/common/TableDensityToggle";
import { FloatingBulkBar } from "@/components/common/FloatingBulkBar";
import { LeadSidePeek, type SidePeekLead } from "@/components/leads/LeadSidePeek";

type Row = {
  id: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  stageLabel: string;
  stageTone: string;
  source: string;
  intendedAmount: string | null;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  createdAt: string | null;
  owner: string | null;
  score: number;
};

const toneStyles: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};
const sourceColors: Record<string, string> = {
  website: "bg-blue-50 text-blue-700 border-blue-200",
  referral: "bg-emerald-50 text-emerald-700 border-emerald-200",
  social_media: "bg-purple-50 text-purple-700 border-purple-200",
  meta_ads: "bg-purple-50 text-purple-700 border-purple-200",
  google: "bg-amber-50 text-amber-700 border-amber-200",
  cold_call: "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/30",
  existing_client: "bg-teal-50 text-teal-700 border-teal-200",
  manual: "bg-gray-50 text-gray-700 border-gray-200",
  walk_in: "bg-teal-50 text-teal-700 border-teal-200",
  webinar: "bg-violet-50 text-violet-700 border-violet-200",
  other: "bg-gray-50 text-gray-700 border-gray-200",
};

export function LeadsTable({ rows, sort, dir = "desc" }: { rows: Row[]; sort: string; dir?: "asc" | "desc" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { density, toggleDensity, isCompact } = useTableDensity("cozy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidePeekLead, setSidePeekLead] = useState<SidePeekLead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function setSort(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "table");
    if (next === "recent") params.delete("sort");
    else params.set("sort", next);
    if (sort === next) {
      params.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      params.delete("dir");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleBulkApply(action: string, payload: Record<string, any>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      let value: string | null = null;
      if (action === "assign") value = payload.rmId ?? null;
      if (action === "stage") value = payload.stage ?? "call_done";

      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action, value }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Failed (${res.status})`);
        return;
      }
      setSelected(new Set());
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  const sortArrow = (key: string) => (sort === key ? (dir === "asc" ? "↑" : "↓") : "");

  return (
    <div className="card-surface overflow-hidden relative">
      {/* Table Sub-header with Density Switcher */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20 border-b border-border text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">
            Showing <strong className="text-foreground">{rows.length}</strong> leads
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TableDensityToggle density={density} onToggle={toggleDensity} />
        </div>
      </div>

      <div className="table-scroll">
        <table className={`w-full ${isCompact ? "text-xs" : "text-sm"} table-modern text-left`} data-table="leads">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"} w-8`}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 rounded" aria-label="Select all" />
              </th>
              <th data-col="score" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                <button onClick={() => setSort("score")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Score <ArrowUpDown className="size-3" /> {sortArrow("score")}
                </button>
              </th>
              <th data-col="name" className={`px-1 ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Name</th>
              <th data-col="stage" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Stage</th>
              <th data-col="intendedAmount" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium text-right pr-6`}>Intended Amount</th>
              <th data-col="source" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Source</th>
              <th data-col="nextFollowUpAt" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Next Follow-Up</th>
              <th data-col="lastContactAt" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Last Contacted</th>
              <th data-col="owner" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Owner (RM)</th>
              <th data-col="createdAt" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                <button onClick={() => setSort("recent")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Created <ArrowUpDown className="size-3" /> {sortArrow("recent")}
                </button>
              </th>
              <th data-col="actions" className={`px-4 ${isCompact ? "py-1.5" : "py-2.5"} text-right font-medium`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const band = leadScoreBand(l.score);
              const isSel = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select, [role='menu'], [data-no-row-nav]")) return;
                    setSidePeekLead(l);
                  }}
                  className={`border-b last:border-0 hover:bg-accent/40 cursor-pointer transition-colors ${
                    isSel ? "bg-brand-cyan-light/30" : ""
                  }`}
                >
                  <td className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <input type="checkbox" checked={isSel} onChange={() => toggle(l.id)} className="size-3.5 rounded" aria-label={`Select ${l.name}`} />
                  </td>
                  <td data-col="score" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <span className={`inline-flex items-center gap-1 chip text-xs border font-bold tabular-nums ${band.chip}`}>
                      <span className={`size-1.5 rounded-full ${band.dot}`} />
                      {l.score}
                    </span>
                  </td>
                  <td data-col="name" className={`px-1 ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                    <div className="flex items-center gap-2">
                      <Avatar src={l.avatarUrl ? `/api/leads/${l.id}/avatar` : null} name={l.name} size={isCompact ? 22 : 28} />
                      <div>
                        <span className="hover:text-brand-navy hover:underline">{l.name}</span>
                        {(l.phone || l.email) && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 space-x-2 font-mono">
                            {l.phone && <span>{l.phone}</span>}
                            {l.phone && l.email && <span>·</span>}
                            {l.email && <span>{l.email}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td data-col="stage" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <span className={`chip text-xs border font-medium ${toneStyles[l.stageTone] ?? "bg-muted"}`}>{l.stageLabel}</span>
                  </td>
                  <td data-col="intendedAmount" className={`${isCompact ? "py-1.5" : "py-2.5"} text-right pr-6 tabular-nums font-semibold`}>
                    {l.intendedAmount ? formatINR(l.intendedAmount) : "—"}
                  </td>
                  <td data-col="source" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <span className={`chip text-xs border ${sourceColors[l.source] ?? "bg-muted"}`}>{l.source.replace(/_/g, " ")}</span>
                  </td>
                  <td data-col="nextFollowUpAt" className={`${isCompact ? "py-1.5" : "py-2.5"} text-xs text-muted-foreground tabular-nums`}>
                    {l.nextFollowUpAt ? formatDate(l.nextFollowUpAt) : "—"}
                  </td>
                  <td data-col="lastContactAt" className={`${isCompact ? "py-1.5" : "py-2.5"} text-xs text-muted-foreground tabular-nums`}>
                    {l.lastContactAt ? formatDate(l.lastContactAt) : "—"}
                  </td>
                  <td data-col="owner" className={`${isCompact ? "py-1.5" : "py-2.5"} text-xs font-medium`}>{l.owner ?? "—"}</td>
                  <td data-col="createdAt" className={`${isCompact ? "py-1.5" : "py-2.5"} text-xs text-muted-foreground tabular-nums`}>
                    {l.createdAt ? formatDate(l.createdAt) : "—"}
                  </td>
                  <td data-col="actions" className={`px-4 ${isCompact ? "py-1.5" : "py-2.5"} text-right`}>
                    <div className="flex items-center justify-end gap-1" data-no-row-nav>
                      <button
                        type="button"
                        onClick={() => setSidePeekLead(l)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Side-Peek Snapshot"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      <RowActions inline editHref={`/dashboard/leads/${l.id}`} deleteUrl={`/api/leads/${l.id}`} itemLabel="lead" itemName={l.name} verb="Delete" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating Bulk Action Bar */}
      <FloatingBulkBar
        selectedCount={selected.size}
        onClear={() => setSelected(new Set())}
        onApplyAction={handleBulkApply}
        busy={busy}
        error={err}
        showStage={true}
        showReview={false}
        showTier={false}
        showSegment={false}
        showCategory={false}
      />

      {/* Split-Screen Side-Peek Drawer */}
      <LeadSidePeek lead={sidePeekLead} onClose={() => setSidePeekLead(null)} />
    </div>
  );
}
