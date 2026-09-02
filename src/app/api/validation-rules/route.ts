import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { validationRules, VALIDATION_SUBJECTS, VALIDATION_OPERATORS, VALIDATION_SEVERITIES } from "@/db/schema";
import { validateRecord } from "@/lib/validation/engine";

export const dynamic = "force-dynamic";
const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head", "compliance"].includes(r));

const Body = z.object({
  name: z.string().min(2).max(120),
  subjectType: z.enum(VALIDATION_SUBJECTS).default("lead"),
  field: z.string().min(1).max(60),
  operator: z.enum(VALIDATION_OPERATORS).default("required"),
  value: z.string().max(200).nullable().optional(),
  appliesWhen: z.record(z.string()).default({}),
  errorMessage: z.string().min(2).max(300),
  severity: z.enum(VALIDATION_SEVERITIES).default("block"),
  isActive: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const subjectType = req.nextUrl.searchParams.get("subjectType");
    const rows = await withTenant(session.tenantId, async (tx) => {
      const cond = subjectType ? sql` AND subject_type = ${subjectType}` : sql``;
      return (await tx.execute(sql`SELECT * FROM validation_rules WHERE tenant_id = ${session.tenantId}::uuid${cond} ORDER BY created_at DESC`)).rows;
    });
    return NextResponse.json({ rules: rows });
  } catch (err: any) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads / compliance" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data; const id = uuid();
    await withTenant(session.tenantId, async (tx) =>
      tx.insert(validationRules).values({ id, tenantId: session.tenantId, ...b, value: b.value ?? null, createdByUserId: session.userId } as any));
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) { return handleApiError(err); }
}

/** PUT /api/validation-rules?check=1 — evaluate a record, return violations. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = z.object({ subjectType: z.enum(VALIDATION_SUBJECTS), record: z.record(z.any()) }).safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const violations = await withTenant(session.tenantId, (tx) =>
      validateRecord(tx as any, { tenantId: session.tenantId, subjectType: body.data.subjectType, record: body.data.record }));
    return NextResponse.json({ violations, ok: violations.filter((v) => v.severity === "block").length === 0 });
  } catch (err: any) { return handleApiError(err); }
}
