/**
 * Public, token-guarded confirmation letter.
 *
 * Unauthenticated by design so the member can forward it to a personal inbox.
 * The token is 32 random bytes, single-purpose, and grants read access to
 * exactly one letter. Runs in SYSTEM context because there is no session to
 * derive a tenant from — the token IS the authorisation, so the lookup is by
 * token and the tenant comes from the row it finds.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { inductionAttempts, inductionEnrolments, inductionTracks, tenants, users } from "@/db/schema";
import { renderInductionLetter } from "@/lib/induction/letter";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Cheap shape check before touching the DB.
  if (!token || token.length < 20 || token.length > 200) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    // Resolve the token in system context (no session ⇒ no tenant yet), then
    // read everything else through withTenant so RLS still scopes the data.
    const found = await withSystem(async (tx) => {
      const [row] = await tx
        .select()
        .from(inductionEnrolments)
        .where(eq(inductionEnrolments.letterToken, token))
        .limit(1);
      return row && row.status === "passed" ? { tenantId: row.tenantId, id: row.id } : null;
    });
    if (!found) return new NextResponse("Not found", { status: 404 });

    const data = await withTenant(found.tenantId, async (tx) => {
      const [enrolment] = await tx
        .select()
        .from(inductionEnrolments)
        .where(eq(inductionEnrolments.id, found.id))
        .limit(1);
      if (!enrolment) return null;

      const [track] = await tx
        .select()
        .from(inductionTracks)
        .where(eq(inductionTracks.id, enrolment.trackId))
        .limit(1);
      const [member] = await tx.select().from(users).where(eq(users.id, enrolment.userId)).limit(1);
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, enrolment.tenantId))
        .limit(1);
      if (!track || !member || !tenant) return null;

      // Score shown on the letter = the attempt that actually passed.
      const [pass] = await tx
        .select()
        .from(inductionAttempts)
        .where(and(eq(inductionAttempts.enrolmentId, enrolment.id), eq(inductionAttempts.passed, true)))
        .orderBy(desc(inductionAttempts.attemptNo))
        .limit(1);

      return { enrolment, track, member, tenant, scorePct: Number(pass?.scorePct ?? 0) };
    });

    if (!data) return new NextResponse("Not found", { status: 404 });

    // Expire the link 90 days after issue — the letter can be re-issued.
    const issued = data.enrolment.letterIssuedAt ? new Date(data.enrolment.letterIssuedAt) : null;
    if (issued && Date.now() - issued.getTime() > 90 * 86400_000) {
      return new NextResponse("This link has expired. Ask your manager to re-issue it.", {
        status: 410,
      });
    }

    const pdf = await renderInductionLetter({
      firmName: (data.tenant as any).displayName ?? (data.tenant as any).name ?? "Your firm",
      firmArn: (data.tenant as any).arn ?? null,
      memberName: (data.member as any).name ?? "Team member",
      memberRole: null,
      trackName: data.track.name,
      completedOn: data.enrolment.completedAt ? new Date(data.enrolment.completedAt) : new Date(),
      scorePct: data.scorePct,
      signatoryName: null,
      signatoryTitle: "Authorised Signatory",
    });

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="induction-confirmation.pdf"`,
        // Not indexable, not cached by shared caches — it names a real person.
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
