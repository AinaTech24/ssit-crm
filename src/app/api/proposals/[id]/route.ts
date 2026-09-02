import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-proposal endpoints.
 *   GET    /api/proposals/[id]
 *   PATCH  /api/proposals/[id]
 *   DELETE /api/proposals/[id]   (soft = status='rejected', rejection_reason='deleted')
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { proposals } from "@/db/schema";
import { proposalTotals } from "@/lib/proposals/projections";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    title: z.string().min(2).max(200).optional(),
    summary: z.string().max(1000).optional(),
    coverLetter: z.string().max(4000).optional(),
    disclaimer: z.string().max(2000).optional(),
    type: z
      .enum(["comprehensive", "mutual_fund", "insurance", "pms", "aif", "mixed"])
      .optional(),
    products: z.array(z.any()).optional(),
    totalInvestment: z.number().optional(),
    expectedCorpus: z.number().optional(),
    riskRating: z.enum(["conservative", "moderate", "aggressive", "mixed"]).optional(),
    status: z
      .enum(["draft", "ready", "sent", "viewed", "accepted", "rejected", "expired"])
      .optional(),
    validUntil: z.string().optional(),
    rejectionReason: z.string().max(500).optional(),
    attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
    suitabilityNote: z.string().max(2000).nullable().optional(),
    suitabilityOverrideReason: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    // Non-managers only see proposals they prepared (mirrors the collection GET).
    if (!row || (!seesAll && row.preparedByUserId !== session.userId)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!before) return null;

      const patch: any = { ...parse.data, updatedAt: new Date() };

      // Stamp status-transition timestamps when status flips
      if (patch.status && patch.status !== before.status) {
        const now = new Date();
        if (patch.status === "sent" && !before.sentAt) patch.sentAt = now;
        if (patch.status === "viewed" && !before.viewedAt) patch.viewedAt = now;
        if (patch.status === "accepted" && !before.acceptedAt) patch.acceptedAt = now;
        if (patch.status === "rejected" && !before.rejectedAt) patch.rejectedAt = now;
      }

      // Coerce dates / numerics for storage
      if (patch.validUntil) patch.validUntil = new Date(patch.validUntil);

      // If products are updated, compute the new totals.
      if (patch.products) {
        const totals = proposalTotals(patch.products);
        patch.totalInvestment = String(totals.totalInvestment ?? 0);
        patch.expectedCorpus = String(totals.expectedCorpus ?? 0);
      } else {
        if (patch.totalInvestment != null) patch.totalInvestment = String(patch.totalInvestment);
        if (patch.expectedCorpus != null) patch.expectedCorpus = String(patch.expectedCorpus);
      }

      const r = await tx
        .update(proposals)
        .set(patch)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.update",
        entityType: "proposal",
        entityId: id,
        before: { status: before.status, title: before.title } as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!before) return;
      await tx
        .update(proposals)
        .set({
          status: "rejected",
          rejectionReason: before.rejectionReason ?? "deleted",
          rejectedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.delete",
        entityType: "proposal",
        entityId: id,
        before: { proposalNumber: before.proposalNumber, status: before.status },
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
