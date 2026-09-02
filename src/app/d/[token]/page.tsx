/**
 * Public document-collection form — accessed via /d/<token>.
 *
 * The MFD's RM picks a list of required documents (PAN, Aadhar, bank
 * statement, photo, cancelled cheque, etc.) and generates a token. The client
 * lands here, uploads each file + fills any free-text fields, and submits.
 * The submission becomes one or more compliance_documents rows linked back
 * to the lead, and the lead's stage moves to `docs_received`.
 */

import { eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, leads, investors } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { PublicDocsForm } from "@/components/public/PublicDocsForm";
import { getFieldChecklist, type KycField } from "@/lib/onboarding/kyc-fields";
import type { ClientType } from "@/lib/onboarding/doc-checklists";

export const dynamic = "force-dynamic";

const DEFAULT_REQUIRED_DOCS = [
  { key: "pan", label: "PAN card (scan or photo)", required: true },
  { key: "aadhar", label: "Aadhar card (front & back)", required: true },
  { key: "photo", label: "Passport-size photograph", required: true },
  { key: "bank_statement", label: "Bank statement / passbook (last 3 months)", required: true },
  { key: "cancelled_cheque", label: "Cancelled cheque", required: true },
  { key: "address_proof", label: "Address proof (if different from Aadhar)", required: false },
];

export default async function PublicDocsFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "document_collection") {
    return <ErrorScreen message="This link is not a document-collection form." />;
  }

  const { tenant, recipientName } = await withSystem(async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    let recipientName = "";
    if (info.subjectType === "lead") {
      const [l] = await tx.select().from(leads).where(eq(leads.id, info.subjectId));
      recipientName = l?.name ?? "";
    } else if (info.subjectType === "investor") {
      const [i] = await tx.select().from(investors).where(eq(investors.id, info.subjectId));
      recipientName = i?.name ?? "";
    }
    return { tenant: t, recipientName };
  });

  const requiredDocs =
    (info.payload?.requiredDocs as Array<{ key: string; label: string; required?: boolean }>) ??
    DEFAULT_REQUIRED_DOCS;

  // KYC data fields — present on links minted after this feature shipped.
  // Older links carry only the clientType (or nothing): derive the field set
  // so existing pending links still collect the data. Either way, strip any
  // back-office field so the customer only ever sees details they can fill
  // themselves (the MFD/back office completes the technical ones in-app).
  const requiredFields: KycField[] = (
    (info.payload?.requiredFields as KycField[] | undefined) ??
    getFieldChecklist((info.payload?.clientType as ClientType) ?? "individual")
  ).filter((f) => !f.backOffice);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-brand-cyan" />
            <span className="font-semibold">{tenant?.displayName ?? tenant?.legalName ?? "Document collection"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{tenant?.arn ? `ARN-${tenant.arn}` : ""}</div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <PublicDocsForm
          tokenId={info.id}
          recipientName={recipientName}
          requiredDocs={requiredDocs}
          requiredFields={requiredFields}
        />
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-6 text-[11px] text-muted-foreground text-center">
        Your documents are uploaded securely and only visible to your relationship manager and back-office team.
        {tenant?.arn ? <> · {tenant.displayName ?? tenant.legalName} · ARN-{tenant.arn}</> : null}
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <FileText className="size-10 text-rose-600 mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
      </div>
    </div>
  );
}
