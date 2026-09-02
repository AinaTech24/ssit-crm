/**
 * Public client feedback submission (NPS) — POST /api/public/feedback/submit.
 *
 * Accepts a public feedback form submission with token ID, rating (1-10),
 * and comment. Saves it as a closed service request of type 'feedback' with CSAT fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { serviceRequests, shareTokens, eventsOutbox, investors, leads } from "@/db/schema";
import { claimShareToken, releaseShareToken, finalizeShareToken } from "@/lib/share-tokens";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const limited = enforce(req, "public.feedback", { limit: 10, windowSec: 60 * 60 });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const tokenId: string | undefined = body.tokenId;
    const rating: number | undefined = Number(body.rating); // 1-10 NPS score
    const comment: string = String(body.comment ?? "").trim();
    const signatureName: string = String(body.signatureName ?? "").trim();

    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!rating || rating < 1 || rating > 10) return NextResponse.json({ error: "Invalid rating (1-10 required)" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    // Step 1: Token lookup (cross-tenant, no session yet)
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "feedback") throw new Error("Not a feedback token");
      return t;
    });

    // Step 1b: claim token
    const claimed = await claimShareToken(tokenId);
    if (!claimed) {
      return NextResponse.json({ error: "This link has already been used" }, { status: 409 });
    }

    let out;
    try {
      out = await withTenant(tk.tenantId!, async (tx) => {
        // Resolve ticket number
        const year = new Date().getFullYear();
        const rand = Math.floor(1000 + Math.random() * 9000);
        const ticketNo = `TKT-${year}-${rand}`;

        const serviceRequestId = uuid();
        const now = new Date();

        // Resolve assigned RM
        let assignedToUserId = null;
        let investorId = null;
        if (tk.subjectType === "investor") {
          investorId = tk.subjectId;
          const [inv] = await tx.select().from(investors).where(eq(investors.id, tk.subjectId)).limit(1);
          if (inv) assignedToUserId = inv.rmId;
        } else if (tk.subjectType === "lead") {
          const [ld] = await tx.select().from(leads).where(eq(leads.id, tk.subjectId)).limit(1);
          if (ld) assignedToUserId = ld.ownerId;
        }

        // Insert service request of type 'feedback'
        await tx.insert(serviceRequests).values({
          id: serviceRequestId,
          tenantId: tk.tenantId,
          ticketNo,
          investorId,
          type: "feedback",
          channel: "form",
          subject: `Client Feedback (NPS: ${rating})`,
          description: comment || `Client submitted feedback with NPS score of ${rating}.`,
          status: "closed", // auto-resolved since it's feedback
          priority: rating <= 6 ? "high" : "normal", // Detractors get higher priority
          assignedToUserId,
          csatRating: rating,
          csatComment: comment || null,
          csatAt: now,
          timeline: [
            { at: now.toISOString(), by: signatureName, event: "Feedback submitted" }
          ]
        } as any);

        // PII / event audit
        await tx.insert(eventsOutbox).values({
          tenantId: tk.tenantId,
          kind: "feedback.submitted",
          entityType: tk.subjectType,
          entityId: tk.subjectId,
          after: { rating, comment, signature: signatureName, serviceRequestId },
          meta: { tokenId, ip, userAgent: ua } as any,
        } as any);

        return { serviceRequestId, rating };
      });
    } catch (e) {
      await releaseShareToken(tokenId).catch(() => {});
      throw e;
    }

    await finalizeShareToken({
      id: tokenId,
      result: { rating, comment, signature: signatureName, serviceRequestId: out.serviceRequestId },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json({ ok: true, rating: out.rating }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
