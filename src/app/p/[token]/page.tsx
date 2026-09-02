/**
 * Public proposal approval page — /p/<token>.
 *
 * Client lands here, sees the proposal summary + the agreed text, types their
 * name as signature, hits Accept. The submission writes proposal_approvals
 * with IP / UA evidence and flips proposal.status to 'accepted'.
 */

import { eq } from "drizzle-orm";
import { FileSignature } from "lucide-react";
import { withSystem } from "@/db/client";
import { tenants, proposals } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { PublicProposalApproval } from "@/components/public/PublicProposalApproval";

export const dynamic = "force-dynamic";

const DEFAULT_ACCEPTANCE_TEXT =
  "I have read and understood this investment proposal. I confirm that the investments listed align with my risk profile and financial goals. I authorise the firm to execute these on my behalf. I am aware that mutual fund investments are subject to market risks.";

export default async function PublicProposalApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "proposal_approval") {
    return <ErrorScreen message="This link is not a proposal approval form." />;
  }

  const { tenant, proposal } = await withSystem(async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, info.subjectId));
    return { tenant: t, proposal: p };
  });

  if (!proposal) return <ErrorScreen message="Proposal not found." />;

  const acceptanceText = String(info.payload?.acceptanceText ?? DEFAULT_ACCEPTANCE_TEXT);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSignature className="size-5 text-brand-cyan" />
            <span className="font-semibold">{tenant?.displayName ?? tenant?.legalName ?? "Proposal"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{tenant?.arn ? `ARN-${tenant.arn}` : ""}</div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <PublicProposalApproval
          tokenId={info.id}
          proposal={{
            id: proposal.id,
            number: proposal.proposalNumber ?? "",
            title: proposal.title,
            recipientName: proposal.recipientName ?? "",
            totalInvestment: proposal.totalInvestment ? Number(proposal.totalInvestment) : null,
            expectedCorpus: proposal.expectedCorpus ? Number(proposal.expectedCorpus) : null,
            riskRating: proposal.riskRating ?? "",
            type: proposal.type,
            validUntil: proposal.validUntil ? new Date(proposal.validUntil as any).toLocaleDateString("en-IN") : null,
            url: `/api/proposals/${proposal.id}/pdf`,
          }}
          acceptanceText={acceptanceText}
        />
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-6 text-[11px] text-muted-foreground text-center">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {tenant?.arn ? <> · {tenant.displayName ?? tenant.legalName} · ARN-{tenant.arn}</> : null}
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <FileSignature className="size-10 text-rose-600 mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
      </div>
    </div>
  );
}
