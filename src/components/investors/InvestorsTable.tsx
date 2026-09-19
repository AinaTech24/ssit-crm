"use client";

/**
 * Investor (client) book table — row selection + bulk actions + sortable
 * columns. Supports high-density (compact) vs cozy view modes and a
 * split-screen side-peek drawer for rapid client inspection.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Loader2,
  X,
  UserCog,
  CalendarClock,
  Layers,
  Tag,
  ArrowUpDown,
  Trash2,
  Eye,
} from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { RmSelector } from "@/components/common/RmSelector";
import { formatINR } from "@/lib/utils";
import { healthBandClasses, type HealthBand } from "@/lib/investors/health";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Avatar } from "@/components/ui/Avatar";
import { TableDensityToggle, useTableDensity } from "@/components/common/TableDensityToggle";
import { FloatingBulkBar } from "@/components/common/FloatingBulkBar";
import { InvestorSidePeek, type SidePeekInvestor } from "@/components/investors/InvestorSidePeek";

export type InvestorTableRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  pan: string | null;
  clientCategory: string | null;
  serviceTier: string | null;
  segmentTag: string | null;
  aum: number;
  sip: number;
  kycStatus: string | null;
  status: string | null;
  healthScore: number;
  healthBand: HealthBand;
  dormDays: number | null;
  completeness: number;
  /** Only carried when the birthday view is on — see InvestorTableFlags. */
  dob?: string | null;
};

export type InvestorTableFlags = {
  showPan: boolean;
  showCategory: boolean;
  showTier: boolean;
  showSegment: boolean;
  showAum: boolean;
  showSip: boolean;
  showKyc: boolean;
  showStatus: boolean;
  /**
   * The list is filtered to one month's birthdays (birthday_month=1), so show
   * the date. Without it the birthday view is the ordinary client table with
   * some rows missing, and nothing on screen says why.
   */
  showBirthday?: boolean;
};

const segmentColors: Record<string, string> = {
  HNI: "bg-violet-50 text-violet-700",
  Affluent: "bg-emerald-50 text-emerald-700",
  Retail: "bg-blue-50 text-blue-700",
  NRI: "bg-pink-50 text-pink-700",
  Corporate: "bg-amber-50 text-amber-700",
};
const tierColors: Record<string, string> = {
  A: "bg-violet-100 text-violet-700",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-blue-100 text-blue-700",
};
const categoryColors: Record<string, string> = {
  A: "bg-amber-100 text-amber-800 border border-amber-300",
  B: "bg-sky-100 text-sky-800 border border-sky-300",
  C: "bg-slate-100 text-slate-700 border border-slate-300",
  D: "bg-rose-50 text-rose-700 border border-rose-200",
};

export function InvestorsTable({
  rows,
  sort,
  dir = "desc",
  flags,
  allIds = [],
  total = 0,
}: {
  rows: InvestorTableRow[];
  sort: string;
  dir?: "asc" | "desc";
  flags: InvestorTableFlags;
  allIds?: string[];
  total?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { density, toggleDensity, isCompact } = useTableDensity("cozy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sidePeekInvestor, setSidePeekInvestor] = useState<SidePeekInvestor | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const allMatchingSelected = allIds.length > 0 && selected.size >= allIds.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function setSort(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "table");
    if (next === "aum") params.delete("sort");
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
      if (action === "review") value = payload.nextReviewAt ? new Date(payload.nextReviewAt).toISOString() : null;
      if (action === "tier") value = payload.serviceTier ?? null;
      if (action === "segment") value = payload.segmentTag ?? null;
      if (action === "category") value = payload.clientCategory ?? null;

      const res = await fetch("/api/investors/bulk", {
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

  const arrow = (key: string) => (sort === key ? (dir === "asc" ? "↑" : "↓") : "");

  return (
    <div className="card-surface overflow-hidden relative">
      {/* Table Sub-header with Density Switcher & Selection Summary */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20 border-b border-border text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">
            Showing <strong className="text-foreground">{rows.length}</strong> of {total || rows.length} clients
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TableDensityToggle density={density} onToggle={toggleDensity} />
        </div>
      </div>

      {/* Phones get card rows — a 12-column table can't shrink to 390px. */}
      <ul className="sm:hidden divide-y divide-border">
        {rows.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => setSidePeekInvestor(i)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-secondary/60"
            >
              <div className="size-9 shrink-0 rounded-full bg-secondary grid place-items-center text-[11px] font-bold text-muted-foreground">
                {i.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {i.sip > 0 ? `SIP ${formatINR(i.sip)}/mo` : "No active SIP"}
                  {i.status && i.status !== "active" ? ` · ${i.status}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{formatINR(i.aum)}</div>
                <div className="text-[10px] text-muted-foreground">AUM</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="table-scroll hidden sm:block">
        <table className={`w-full ${isCompact ? "text-xs" : "text-sm"}`} data-table="investors">
          <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
            <tr>
              <th className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"} w-8`}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="size-3.5 rounded"
                  aria-label="Select all"
                />
              </th>
              <th data-col="name" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                <button onClick={() => setSort("name")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Name <ArrowUpDown className="size-3" />
                  {arrow("name")}
                </button>
              </th>
              {flags.showBirthday && <th data-col="birthday" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Birthday</th>}
              {flags.showPan && <th data-col="pan" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>PAN</th>}
              {flags.showCategory && <th data-col="category" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Category</th>}
              {flags.showTier && <th data-col="tier" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Tier</th>}
              {flags.showSegment && <th data-col="segment" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Segment</th>}
              {flags.showAum && (
                <th data-col="aum" className={`text-right ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                  <button onClick={() => setSort("aum")} className="inline-flex items-center gap-1 hover:text-foreground">
                    AUM <ArrowUpDown className="size-3" />
                    {arrow("aum")}
                  </button>
                </th>
              )}
              {flags.showSip && (
                <th data-col="sip" className={`text-right ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                  <button onClick={() => setSort("sip")} className="inline-flex items-center gap-1 hover:text-foreground">
                    SIP <ArrowUpDown className="size-3" />
                    {arrow("sip")}
                  </button>
                </th>
              )}
              {flags.showKyc && <th data-col="kyc" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium pl-4`}>KYC</th>}
              <th data-col="health" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                <button onClick={() => setSort("health")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Health <ArrowUpDown className="size-3" />
                  {arrow("health")}
                </button>
              </th>
              <th data-col="complete" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Profile</th>
              {flags.showStatus && <th data-col="status" className={`text-left ${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>Status</th>}
              <th data-col="actions" className={`px-4 ${isCompact ? "py-1.5" : "py-2.5"} text-right font-medium`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const cls = healthBandClasses(i.healthBand);
              const dorm = i.dormDays != null && i.dormDays > 180;
              const isSel = selected.has(i.id);
              return (
                <tr
                  key={i.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select, [role='menu'], [data-no-row-nav]")) return;
                    setSidePeekInvestor(i);
                  }}
                  className={`border-b last:border-0 hover:bg-accent/40 cursor-pointer transition-colors ${
                    isSel ? "bg-brand-cyan-light/30" : ""
                  }`}
                >
                  <td className={`px-3 ${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(i.id)}
                      className="size-3.5 rounded"
                      aria-label={`Select ${i.name}`}
                    />
                  </td>
                  <td data-col="name" className={`${isCompact ? "py-1.5" : "py-2.5"} font-medium`}>
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={i.avatarUrl ? `/api/investors/${i.id}/avatar` : null}
                        name={i.name}
                        size={isCompact ? 22 : 28}
                      />
                      <span className="hover:text-brand-navy hover:underline">{i.name}</span>
                    </div>
                  </td>
                  {flags.showBirthday && (
                    <td data-col="birthday" className={`${isCompact ? "py-1.5" : "py-2.5"} ${isCompact ? "text-[11px]" : "text-xs"} whitespace-nowrap`}>
                      {birthdayCell(i.dob)}
                    </td>
                  )}
                  {flags.showPan && (
                    <td data-col="pan" className={`${isCompact ? "py-1.5" : "py-2.5"} font-mono text-muted-foreground ${isCompact ? "text-[11px]" : "text-xs"}`}>
                      {i.pan}
                    </td>
                  )}
                  {flags.showCategory && (
                    <td data-col="category" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                      {i.clientCategory ? (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${categoryColors[i.clientCategory] ?? ""}`}
                          title={`Client Category ${i.clientCategory}`}
                        >
                          {i.clientCategory}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {flags.showTier && (
                    <td data-col="tier" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                      {i.serviceTier ? (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${tierColors[i.serviceTier] ?? ""}`}
                          title={
                            i.serviceTier === "A"
                              ? "Quarterly review"
                              : i.serviceTier === "B"
                              ? "Half-yearly review"
                              : "Annual review"
                          }
                        >
                          {i.serviceTier}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {flags.showSegment && (
                    <td data-col="segment" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                      {i.segmentTag && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${segmentColors[i.segmentTag] ?? ""}`}>
                          {i.segmentTag}
                        </span>
                      )}
                    </td>
                  )}
                  {flags.showAum && (
                    <td data-col="aum" className={`${isCompact ? "py-1.5" : "py-2.5"} text-right tabular-nums font-semibold`}>
                      {formatINR(i.aum)}
                    </td>
                  )}
                  {flags.showSip && (
                    <td data-col="sip" className={`${isCompact ? "py-1.5" : "py-2.5"} text-right tabular-nums text-muted-foreground`}>
                      {i.sip > 0 ? `${formatINR(i.sip)}/mo` : "—"}
                    </td>
                  )}
                  {flags.showKyc && (
                    <td data-col="kyc" className={`${isCompact ? "py-1.5" : "py-2.5"} pl-4`}>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          i.kycStatus === "verified"
                            ? "bg-emerald-50 text-emerald-700"
                            : i.kycStatus === "expired"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {i.kycStatus ?? "pending"}
                      </span>
                    </td>
                  )}
                  <td data-col="health" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${cls.chip}`}>
                      {i.healthScore}/100
                    </span>
                  </td>
                  <td data-col="complete" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-cyan rounded-full"
                          style={{ width: `${i.completeness}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{i.completeness}%</span>
                    </div>
                  </td>
                  {flags.showStatus && (
                    <td data-col="status" className={`${isCompact ? "py-1.5" : "py-2.5"}`}>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                          i.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : i.status === "dormant"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {i.status ?? "active"}
                      </span>
                    </td>
                  )}
                  <td data-col="actions" className={`px-4 ${isCompact ? "py-1.5" : "py-2.5"} text-right`}>
                    <div className="flex items-center justify-end gap-1" data-no-row-nav>
                      <button
                        type="button"
                        onClick={() => setSidePeekInvestor(i)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Side-Peek Snapshot"
                      >
                        <Eye className="size-3.5" />
                      </button>
                      <RowActions
                        items={[
                          { label: "View Full Profile", href: `/dashboard/investors/${i.id}` },
                          { label: "Create Proposal", href: `/dashboard/proposals/new?investorId=${i.id}` },
                          { label: "Schedule Review", href: `/dashboard/review-meetings/new?investorId=${i.id}` },
                          { label: "Log Service Request", href: `/dashboard/service-requests/new?investorId=${i.id}` },
                        ]}
                      />
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
        totalMatching={total}
        allSelected={allSelected}
        allMatchingSelected={allMatchingSelected}
        onSelectAllMatching={() => setSelected(new Set(allIds))}
        onClear={() => setSelected(new Set())}
        onApplyAction={handleBulkApply}
        busy={busy}
        error={err}
      />

      {/* Split-Screen Side-Peek Drawer */}
      <InvestorSidePeek investor={sidePeekInvestor} onClose={() => setSidePeekInvestor(null)} />
    </div>
  );
}

/**
 * "19 Sep · turns 38" — the birthday view's date cell. Today is called out,
 * because the whole point of opening the month is to catch the ones that have
 * already arrived.
 */
function birthdayCell(dob: string | null | undefined) {
  if (!dob) return <span className="text-muted-foreground">—</span>;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>;
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  const age = now.getFullYear() - d.getFullYear();
  const turning = age > 0 && age < 130 ? age : null;
  return (
    <span className={isToday ? "font-semibold text-rose-600" : ""}>
      {d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
      {isToday ? " · today 🎉" : turning ? ` · turns ${turning}` : ""}
    </span>
  );
}
