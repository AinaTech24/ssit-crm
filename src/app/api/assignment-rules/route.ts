import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { assignmentRules, ASSIGNMENT_SUBJECTS, ASSIGNMENT_STRATEGIES } from "@/db/schema";

export const dynamic = "force-dynamic";
const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  name: z.string().min(2).max(120),
  subjectType: z.enum(ASSIGNMENT_SUBJECTS).default("lead"),
  strategy: z.enum(ASSIGNMENT_STRATEGIES).default("round_robin"),
  targetUserIds: z.array(z.string().uuid()).min(1).max(50),
  criteria: z.record(z.string()).default({}),
  priority: z.number().int().min(0).max(1000).default(100),
  isActive: z.boolean().default(true),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT ar.*, (SELECT json_agg(u.name) FROM users u WHERE u.id = ANY(ARRAY(SELECT jsonb_array_elements_text(ar.target_user_ids))::uuid[])) AS target_names
        FROM assignment_rules ar WHERE ar.tenant_id = ${session.tenantId}::uuid ORDER BY ar.priority ASC, ar.created_at DESC`);
      return r.rows;
    });
    return NextResponse.json({ rules: rows });
  } catch (err: any) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data; const id = uuid(); const meta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(assignmentRules).values({ id, tenantId: session.tenantId, ...b, createdByUserId: session.userId } as any);
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "assignment_rule.create", entityType: "assignment_rule", entityId: id, after: { name: b.name } as any, ...meta });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) { return handleApiError(err); }
}
