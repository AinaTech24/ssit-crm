/**
 * Legal registrations list — every statutory + regulatory license / cert
 * the firm holds. SEBI inspection: this is the page the compliance
 * officer brings up when asked "show me all your registrations".
 */

import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { legalRegistrations } from "@/db/schema";

export const dynamic = "force-dynamic";

const AUTHORITY_LABELS: Record<string, string> = {
  AMFI: "AMFI",
  SEBI: "SEBI",
  IRDAI: "IRDAI",
  GST: "GST",
  Income_Tax: "Income Tax",
  MCA: "MCA / ROC",
  RBI: "RBI",
  State_Govt: "State Govt",
  Local_Authority: "Local Authority",
  Trademark_Registry: "Trademark Registry",
  FIU_IND: "FIU-IND",
  Other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-rose-100 text-rose-800",
  pending_renewal: "bg-amber-50 text-amber-700",
  surrendered: "bg-gray-100 text-gray-600",
  rejected: "bg-rose-50 text-rose-700",
};

export default async function LegalRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; authority?: string }>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "compliance.edit", session.permissions);
  await assertActiveLicense(session.tenantId, session.roles);
  const sp = await searchParams;
  const statusFilter = sp.status ?? "active";
  const authorityFilter = sp.authority ?? "all";

  // Single fetch — the register is small, so we load the tenant's rows once and
  // derive both the (effective-status-)filtered table and the KPI counts in JS.
  const all = await withTenant(session.tenantId, async (tx) =>
    tx
      .select()
      .from(legalRegistrations)
      .where(eq(legalRegistrations.tenantId, session.tenantId))
      .orderBy(legalRegistrations.expiryAt)
  );

  const rows = all.filter(
    (r) =>
      (statusFilter === "all" || effectiveStatus(r) === statusFilter) &&
      (authorityFilter === "all" || r.authority === authorityFilter)
  );

  // KPIs use the EFFECTIVE status (date-derived), so a license that lapsed but
  // was never manually flipped still shows up as expired — and one expiring
  // today is counted in "≤ 60d" (both compared at midnight; perpetual never alarms).
  const counts = {
    total: all.length,
    active: all.filter((r) => effectiveStatus(r) === "active").length,
    pending: all.filter((r) => effectiveStatus(r) === "pending_renewal").length,
    expired: all.filter((r) => effectiveStatus(r) === "expired").length,
    expiring60: all.filter((r) => {
      const d = daysToExpiry(r);
      return (
        d !== null &&
        d >= 0 &&
        d <= 60 &&
        ["active", "pending_renewal"].includes(effectiveStatus(r))
      );
    }).length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Legal registrations</h1>
        </div>
        <Link
          href="/dashboard/legal-registrations/new"
          className="btn-primary text-sm"
        >
          <Plus className="size-4" /> Add registration
        </Link>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile label="Total" value={counts.total} />
        <Tile label="Active" value={counts.active} tone="emerald" />
        <Tile
          label="Pending renewal"
          value={counts.pending}
          tone={counts.pending > 0 ? "amber" : undefined}
        />
        <Tile
          label="Expiring ≤ 60d"
          value={counts.expiring60}
          tone={counts.expiring60 > 0 ? "amber" : undefined}
        />
        <Tile
          label="Expired"
          value={counts.expired}
          tone={counts.expired > 0 ? "rose" : undefined}
        />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: "active", label: "Active" },
          { value: "pending_renewal", label: "Pending renewal" },
          { value: "expired", label: "Expired" },
          { value: "all", label: "All" },
        ].map((s) => (
          <Link
            key={s.value}
            href={`/dashboard/legal-registrations?status=${s.value}${authorityFilter !== "all" ? `&authority=${authorityFilter}` : ""
              }`}
            className={`chip text-xs ${statusFilter === s.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100"
              }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No registrations match this filter yet.
          </p>
          <Link
            href="/dashboard/legal-registrations/new"
            className="btn-primary text-sm mt-4"
          >
            <Plus className="size-4" /> Add the first registration
          </Link>
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-xs min-w-[1024px]">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left">Registered in name of</th>
                <th className="px-3 py-2 text-left">Authority</th>
                <th className="px-3 py-2 text-left">Registration for</th>
                <th className="px-3 py-2 text-left">Number</th>
                <th className="px-3 py-2 text-left">Reg. date</th>
                <th className="px-3 py-2 text-left">Expiry</th>
                <th className="px-3 py-2 text-left">Renewal</th>
                <th className="px-3 py-2 text-left">Docs</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/legal-registrations/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.registeredInNameOf}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.authority === "Other" && r.authorityOther
                      ? r.authorityOther
                      : AUTHORITY_LABELS[r.authority] ?? r.authority}
                  </td>
                  <td className="px-3 py-2 max-w-[260px] truncate" title={r.registrationFor}>
                    {r.registrationFor}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {r.registrationNumber ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.registrationDate ? fmt(String(r.registrationDate)) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ExpiryBadge
                      date={r.expiryAt ? String(r.expiryAt) : null}
                      perpetual={r.renewalFrequency === "perpetual"}
                    />
                  </td>
                  <td className="px-3 py-2 capitalize">
                    {r.renewalFrequency.replace("_", " ")}
                  </td>
                  <td className="px-3 py-2">
                    {(r.documents ?? []).length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-violet-700">
                        <FileText className="size-3" />
                        {(r.documents ?? []).length}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const eff = effectiveStatus(r);
                      return (
                        <span
                          className={`chip text-[10px] ${STATUS_TONE[eff] ?? "bg-slate-100"}`}
                          title={eff !== r.status ? `Marked "${r.status}", but lapsed by date` : undefined}
                        >
                          {eff.replace("_", " ")}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "rose";
}) {
  const cardTone =
    value > 0 && tone === "rose"
      ? "border-rose-200 bg-rose-50/40"
      : value > 0 && tone === "amber"
        ? "border-amber-200 bg-amber-50/40"
        : value > 0 && tone === "emerald"
          ? "border-emerald-200 bg-emerald-50/40"
          : "";
  return (
    <div className={`card-surface p-3 ${cardTone}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ExpiryBadge({ date, perpetual }: { date: string | null; perpetual?: boolean }) {
  // A perpetual license never expires — show a neutral chip, never a red alarm,
  // even if an expiry date was entered by mistake.
  if (perpetual) return <span className="chip bg-slate-100 text-[10px]">Perpetual</span>;
  if (!date) return <span className="chip bg-slate-100 text-[10px]">Perpetual</span>;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone =
    days < 0
      ? "bg-rose-100 text-rose-800 line-through"
      : days < 30
        ? "bg-rose-50 text-rose-700"
        : days < 90
          ? "bg-amber-50 text-amber-700"
          : "bg-emerald-50 text-emerald-700";
  return (
    <span className={`chip text-[10px] ${tone}`} title={date}>
      {fmt(date)}
      {days >= 0 ? (
        <span className="ml-1 text-[9px] opacity-70">{days}d</span>
      ) : (
        <span className="ml-1 text-[9px] opacity-70">expired</span>
      )}
    </span>
  );
}

/** Whole days until expiry, both floored to midnight. null = no enforced expiry
 *  (perpetual licenses, or no expiry date set) — these never alarm. */
function daysToExpiry(r: { expiryAt: unknown; renewalFrequency: string }): number | null {
  if (!r.expiryAt || r.renewalFrequency === "perpetual") return null;
  const d = new Date(String(r.expiryAt));
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Status as it ACTUALLY stands today: a still-"active"/"pending" license whose
 *  date has passed reads as expired (the stored status field is only updated
 *  manually or by the nightly scanner). Surrendered/rejected/expired are terminal. */
function effectiveStatus(r: { status: string; expiryAt: unknown; renewalFrequency: string }): string {
  if (r.status === "surrendered" || r.status === "rejected" || r.status === "expired") return r.status;
  const d = daysToExpiry(r);
  if (d !== null && d < 0) return "expired";
  return r.status;
}

function fmt(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return d;
  }
}
