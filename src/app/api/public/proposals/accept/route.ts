/**
 * Public proposal approval — POST /api/public/proposals/accept.
 *
 * Records SEBI-grade evidence into proposal_approvals + flips the proposal
 * status to 'accepted'. Pushes an outbox event so a workflow can fire the
 * "send KYC docs collection form" comm or whatever the firm has configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens, proposals, proposalApprovals, eventsOutbox, leads } from "@/db/schema";
import { claimShareToken, releaseShareToken, finalizeShareToken } from "@/lib/share-tokens";
import { transitionTo } from "@/lib/blueprints/engine";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // 10 acceptances per IP per hour. A real client clicks "Accept" once.
    const limited = enforce(req, "public.proposal-accept", { limit: 10, windowSec: 60 * 60 });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId ?? "");
    // Bound the untrusted input — these land in proposal_approvals text columns.
    const signatureName = String(body.signatureName ?? "").trim().slice(0, 120);
    const acceptanceText = String(body.acceptanceText ?? "").trim().slice(0, 5000);
    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });
    if (!acceptanceText) return NextResponse.json({ error: "Missing acceptance text" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    // Step 1: token lookup (cross-tenant — no session yet).
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "proposal_approval") throw new Error("Not a proposal-approval token");
      return t;
    });

    // Step 1b: atomically CLAIM the single-use token before doing any work, so
    // two concurrent accepts can't both record a (SEBI-grade) approval +
    // double-fire the downstream "send KYC docs" workflow. The loser aborts.
    const claimed = await claimShareToken(tokenId);
    if (!claimed) {
      return NextResponse.json({ error: "This link has already been used" }, { status: 409 });
    }

    // Step 2: writes happen inside the token's tenant scope so RLS blocks
    // any cross-tenant write even if a future bug leaks tokenId across
    // tenants. If the work throws after the claim, release the token so the
    // client can retry.
    let out;
    try {
      out = await withTenant(tk.tenantId!, async (tx) => {
      const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, tk.subjectId));
      if (!proposal) throw new Error("Proposal not found");

      const approvalId = uuid();
      const now = new Date();

      await tx.insert(proposalApprovals).values({
        id: approvalId,
        tenantId: tk.tenantId,
        proposalId: tk.subjectId,
        acceptanceText,
        signatureName,
        channel: "portal" as any,
        ipAddress: ip,
        userAgent: ua,
        shareTokenId: tk.id,
        acceptedAt: now,
      } as any);

      await tx
        .update(proposals)
        .set({
          status: "accepted" as any,
          acceptedAt: now,
          updatedAt: now,
        } as any)
        .where(eq(proposals.id, tk.subjectId));

      // If the proposal was for a lead, advance that lead's stage too
      if ((proposal as any).leadId) {
        await tx
          .update(leads)
          .set({
            stage: "proposal_approved" as any,
            stageChangedAt: now,
            updatedAt: now,
          } as any)
          .where(eq(leads.id, (proposal as any).leadId));
        // Advance blueprint instance
        try {
          await transitionTo(tx, tk.tenantId!, (proposal as any).leadId, "proposal_approved", {
            systemBypass: true,
            remarks: `Client approved proposal ${(proposal as any).proposalNumber} via secure link.`,
          });
        } catch (e) {
          console.error("[proposals/accept] blueprint advance failed:", e);
        }
      }

      await tx.insert(eventsOutbox).values({
        tenantId: tk.tenantId,
        kind: "proposal.accepted",
        entityType: "proposal",
        entityId: tk.subjectId,
        after: { approvalId, signature: signatureName, leadId: (proposal as any).leadId ?? null },
        meta: { tokenId, ip, userAgent: ua } as any,
      } as any);

      // Token already claimed up front; finalized after the tx commits below.
      return { approvalId };
      });
    } catch (e) {
      // Work failed after the claim — release so the client can retry.
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    // Confirm the claim by storing the result payload (used_at already set).
    await finalizeShareToken({
      id: tokenId,
      result: { approvalId: out.approvalId, signature: signatureName },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json(out, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
