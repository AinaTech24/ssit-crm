import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft, User, Calendar, Briefcase } from "lucide-react";
import { withTenant } from "@/db/client";
import { businessEntries, businessEntryLines, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";
import { ASSET_CLASS_LABELS, ASSET_CLASS_ORDER, type AssetClass } from "@/lib/business/asset-class";
import { BusinessEntryActions } from "@/components/business/BusinessEntryActions";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const PRODUCT_LABEL: Record<string, string> = { mutual_fund: "Mutual Fund", pms: "PMS", aif: "AIF", sif: "SIF", bond: "Bond", ncd: "NCD", other: "Other" };
const TXN_LABEL: Record<string, string> = { sip: "SIP", sip_topup: "SIP Top-Up", sip_stop: "SIP Stop", other: "Others", lumpsum: "Lumpsum", additional_purchase: "Add'l Purchase", switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption" };
const STATUS_TONE: Record<string, string> = { draft: "bg-slate-100 text-slate-600", confirmed: "bg-sky-50 text-sky-700", emailed: "bg-emerald-50 text-emerald-700", cancelled: "bg-rose-50 text-rose-600" };

export default async function BusinessEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) redirect("/dashboard");
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [entry] = await tx
      .select()
      .from(businessEntries)
      .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
      .limit(1);
    if (!entry) return null;
    const lines = await tx.select().from(businessEntryLines).where(eq(businessEntryLines.entryId, id)).orderBy(asc(businessEntryLines.sortOrder));
    const rm = entry.rmId ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, entry.rmId)).limit(1))[0] : null;
    let email: string | null = null;
    if (entry.investorId) {
      const [inv] = await tx.select({ email: investors.email }).from(investors).where(eq(investors.id, entry.investorId)).limit(1);
      email = inv?.email ?? null;
    }
    const exec = entry.executedById ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, entry.executedById)).limit(1))[0] : null;
    return { entry, lines, rmName: rm?.name ?? null, executedByName: exec?.name ?? null, email };
  });
  if (!data) notFound();

  const { entry, lines } = data;
  const breakup = (entry.assetBreakup ?? {}) as Record<string, number>;
  const dateStr = new Date(entry.businessDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/business-entries" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to entries
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {entry.clientName}
            <span className={`chip text-[10px] capitalize ${STATUS_TONE[entry.status] ?? ""}`}>{entry.status}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-1">
            <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" /> {PRODUCT_LABEL[entry.productType] ?? entry.productType}</span>
            <span className="inline-flex items-center gap-1"><Calendar className="size-3.5" /> {dateStr}</span>
            {data.rmName && <span className="inline-flex items-center gap-1"><User className="size-3.5" /> {data.rmName}</span>}
            {data.executedByName && <span className="inline-flex items-center gap-1"><User className="size-3.5" /> Executed by {data.executedByName}</span>}
          </div>
        </div>
        <BusinessEntryActions id={entry.id} status={entry.status} hasEmail={!!data.email} />
        <RecordProvenance
          entityType="business_entry"
          entityId={entry.id}
          createdAt={entry.createdAt}
          updatedAt={entry.updatedAt}
          className="basis-full mt-1"
        />
      </div>

      {/* Summary cards */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground">Total business</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{formatINR(Number(entry.totalAmount))}</div>
        </div>
        <div className="card-surface p-4 sm:col-span-2">
          <div className="text-xs text-muted-foreground mb-2">Asset class breakup</div>
          <div className="flex flex-wrap gap-1.5">
            {ASSET_CLASS_ORDER.filter((k) => (breakup[k] ?? 0) > 0).map((k) => (
              <span key={k} className="chip text-[11px] bg-secondary">
                {ASSET_CLASS_LABELS[k as AssetClass]}: <span className="font-semibold ml-1 tabular-nums">{formatINR(breakup[k])}</span>
              </span>
            ))}
            {Number(entry.liquidNet) !== 0 && (
              <span className="chip text-[11px] bg-sky-50 text-sky-700">Liquid net: <span className="font-semibold ml-1 tabular-nums">{formatINR(Number(entry.liquidNet))}</span></span>
            )}
          </div>
        </div>
      </div>

      {/* Scheme lines */}
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Scheme</th>
              <th className="text-left py-2 font-medium">Type</th>
              <th className="text-left py-2 font-medium">Class</th>
              <th className="text-right py-2 font-medium pr-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{l.schemeName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {l.amcName ? `${l.amcName}` : ""}{l.assetCategory ? `${l.amcName ? " · " : ""}${l.assetCategory}` : ""}
                    {l.fromSchemeName ? `  ·  from ${l.fromSchemeName}` : ""}
                  </div>
                </td>
                <td className="py-2.5 text-xs">
                  {TXN_LABEL[l.txnType] ?? l.txnType}{l.frequency ? <span className="text-muted-foreground"> · {l.frequency.replace(/_/g, " ")}</span> : null}{l.sipDate && (l.txnType === "sip" || l.txnType === "swp") ? <span className="text-muted-foreground"> · day {l.sipDate}</span> : null}
                </td>
                <td className="py-2.5 text-xs capitalize text-muted-foreground">{l.assetClass}</td>
                <td className="py-2.5 text-right tabular-nums font-medium pr-4">{formatINR(Number(l.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entry.notes && (
        <div className="card-surface p-4">
          <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
          <p className="text-sm whitespace-pre-wrap">{entry.notes}</p>
        </div>
      )}
      {entry.emailedAt && (
        <p className="text-xs text-muted-foreground">
          Confirmation emailed to the client on {new Date(entry.emailedAt).toLocaleString("en-IN")}.
        </p>
      )}
    </div>
  );
}
