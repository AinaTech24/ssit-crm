import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft, LifeBuoy } from "lucide-react";
import { withTenant } from "@/db/client";
import { serviceRequests, investors, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ServiceRequestDetailEditor } from "@/components/service-requests/ServiceRequestDetailEditor";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update", bank_update: "Bank Update", mobile_update: "Mobile Update",
  email_update: "Email Update", kyc_update: "KYC Update", minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report", statement_request: "Statement Request",
  redemption_request: "Redemption Request", switch_request: "Switch Request",
  transmission_case: "Transmission Case", folio_correction: "Folio Correction", other: "Other",
  complaint: "Complaint", redemption_help: "Redemption Request", switch_help: "Switch Request",
  transaction_query: "Other",
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700", in_progress: "bg-amber-50 text-amber-700",
  waiting_customer: "bg-slate-50 text-slate-700", resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-gray-50 text-gray-700", escalated: "bg-rose-50 text-rose-700",
};

export default async function ServiceRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const sr = (await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, session.tenantId))).limit(1))[0];
    if (!sr) return null;
    const inv = sr.investorId
      ? (await tx.select().from(investors).where(eq(investors.id, sr.investorId)).limit(1))[0]
      : null;
    // userId → name map for the activity timeline + assignee display.
    const us = await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid`);
    const userMap: Record<string, string> = {};
    for (const u of us.rows as Array<{ id: string; name: string }>) userMap[u.id] = u.name;
    return { sr, investor: inv, userMap };
  });
  if (!data) notFound();
  const { sr, investor, userMap } = data;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Link href="/dashboard/service-requests" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to service requests
      </Link>

      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <LifeBuoy className="size-6 text-brand-cyan" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{TYPE_LABEL[sr.type] ?? sr.type}</h1>
            <span className={`chip capitalize ${STATUS_TONE[sr.status] ?? ""}`}>{sr.status.replace(/_/g, " ")}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono">{sr.ticketNo}</span>
            <span>·</span>
            {investor ? (
              <Link href={`/dashboard/investors/${investor.id}`} className="hover:underline">{investor.name}</Link>
            ) : (
              <span>No client linked</span>
            )}
            {sr.channel && <><span>·</span><span className="capitalize">{sr.channel.replace(/_/g, " ")}</span></>}
          </div>
          {sr.subject && <p className="mt-2 font-medium">{sr.subject}</p>}
          {sr.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{sr.description}</p>}
          <RecordProvenance
            entityType="service_request"
            entityId={sr.id}
            createdAt={sr.createdAt}
            updatedAt={sr.updatedAt}
            className="mt-2"
          />
        </div>
      </div>

      <ServiceRequestDetailEditor sr={JSON.parse(JSON.stringify(sr))} userMap={userMap} />
    </div>
  );
}
