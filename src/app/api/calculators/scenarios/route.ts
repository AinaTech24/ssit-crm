import { handleApiError } from "@/lib/api/error-handler";
/**
 * Saved calculator scenarios.
 *
 *   GET    ?calculatorKey=&investorId=   → list (newest first, max 100)
 *   POST   { calculatorKey, title, inputs, results?, investorId? } → save
 *   DELETE ?id=<uuid>                    → remove (own tenant via RLS)
 *
 * Backs the "Save scenario" / "My scenarios" UI in the Calculators module.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { calcScenarios } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const calculatorKey = (searchParams.get("calculatorKey") ?? "").trim();
    const investorId = (searchParams.get("investorId") ?? "").trim();

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds = [eq(calcScenarios.tenantId, session.tenantId)];
      if (calculatorKey) conds.push(eq(calcScenarios.calculatorKey, calculatorKey));
      if (investorId) conds.push(eq(calcScenarios.investorId, investorId));
      return tx
        .select()
        .from(calcScenarios)
        .where(and(...conds))
        .orderBy(desc(calcScenarios.createdAt))
        .limit(100);
    });

    return NextResponse.json({ scenarios: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

const PostBody = z.object({
  calculatorKey: z.string().min(1).max(60),
  title: z.string().min(1).max(160),
  inputs: z.record(z.string(), z.any()),
  results: z.record(z.string(), z.any()).optional(),
  investorId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;

    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .insert(calcScenarios)
        .values({
          tenantId: session.tenantId,
          userId: session.userId,
          investorId: b.investorId ?? null,
          calculatorKey: b.calculatorKey,
          title: b.title,
          inputs: b.inputs,
          results: b.results ?? null,
        } as any)
        .returning();
      return r;
    });

    return NextResponse.json({ scenario: row }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .delete(calcScenarios)
        .where(and(eq(calcScenarios.id, id), eq(calcScenarios.tenantId, session.tenantId)));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
