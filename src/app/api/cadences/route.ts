import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { cadences, CADENCE_SUBJECTS, CADENCE_STEP_ACTIONS } from "@/db/schema";

export const dynamic = "force-dynamic";
const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Step = z.object({ dayOffset: z.number().int().min(0).max(365), action: z.enum(CADENCE_STEP_ACTIONS), channel: z.string().max(20).optional(), title: z.string().min(1).max(200), notes: z.string().max(1000).optional() });
const Body = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(300).optional(),
  subjectType: z.enum(CADENCE_SUBJECTS).default("lead"),
  steps: z.array(Step).min(1).max(12),
  isActive: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const subjectType = req.nextUrl.searchParams.get("subjectType");
    const rows = await withTenant(session.tenantId, async (tx) => {
      const cond = subjectType ? sql` AND subject_type = ${subjectType}` : sql``;
      return (await tx.execute(sql`SELECT * FROM cadences WHERE tenant_id = ${session.tenantId}::uuid${cond} ORDER BY created_at DESC`)).rows;
    });
    return NextResponse.json({ cadences: rows });
  } catch (err: any) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data; const id = uuid();
    await withTenant(session.tenantId, async (tx) =>
      tx.insert(cadences).values({ id, tenantId: session.tenantId, name: b.name, description: b.description ?? null, subjectType: b.subjectType, steps: b.steps.sort((x, y) => x.dayOffset - y.dayOffset), isActive: b.isActive, createdByUserId: session.userId } as any));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) { return handleApiError(err); }
}
