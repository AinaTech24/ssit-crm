import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/proposals/[id]/pdf
 *
 * The proposal PDF, rendered by the SAME renderProposalPdf() the "Send via
 * email" attachment uses — so the downloaded file is byte-for-byte the document
 * the client receives. ?download=1 forces a save dialog (default: inline).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { proposals, tenants } from "@/db/schema";
import { renderProposalPdf } from "@/lib/proposal/proposal-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.view", session.permissions);
    // Managers (full client view / compliance) see any proposal; everyone else
    // only the proposals they prepared — mirrors the collection GET. Otherwise
    // any role could pull any client's proposal PDF (recommendations, amounts).
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)))
        .limit(1);
      if (!p) return null;
      if (!seesAll && p.preparedByUserId !== session.userId) return null;
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const pdf = await renderProposalPdf({
        proposal: p as any,
        brand: {
          displayName: (t as any)?.displayName,
          legalName: (t as any)?.legalName,
          arn: (t as any)?.arn,
          euin: (t as any)?.euin,
          primaryColor: (t as any)?.primaryColor,
          secondaryColor: (t as any)?.secondaryColor,
          logoUrl: (t as any)?.logoUrl,
        },
      });
      return { pdf, num: p.proposalNumber ?? id };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    const safe = String(built.num).replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="Proposal_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
