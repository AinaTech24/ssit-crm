import { handleApiError } from "@/lib/api/error-handler";
/**
 * Custom reports collection.
 *   GET  /api/reports/saved   — reports visible to the caller
 *   POST /api/reports/saved   — create a report
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, or, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports, REPORT_SUBJECTS, REPORT_TYPES, REPORT_SHARE_SCOPES, REPORT_AGGREGATES } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { assertValidReport } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

const SummarySchema = z.object({
  groupBy: z.array(z.string().max(60)).min(1).max(3),
  columns: z.array(z.string().max(60)).max(40).optional(),
  aggregates: z
    .array(z.object({ field: z.string().max(60).optional().default(""), fn: z.enum(REPORT_AGGREGATES), label: z.string().max(60).optional() }))
    .max(8)
    .optional(),
  showDetailRows: z.boolean().optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
});

const ReportBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  subject: z.enum(REPORT_SUBJECTS),
  reportType: z.enum(REPORT_TYPES).default("detailed"),
  ast: FilterASTSchema.nullable().optional(),
  columns: z.array(z.string().max(60)).max(40).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  matrix: z
    .object({
      groupBy: z.string(),
      pivot: z.string().optional(),
      aggregate: z.enum(REPORT_AGGREGATES),
      measure: z.string().optional(),
    })
    .nullable()
    .optional(),
  summary: SummarySchema.nullable().optional(),
  folder: z.string().max(80).nullable().optional(),
  chartType: z.enum(["none", "bar", "pie", "line", "area", "donut"]).optional(),
  sharedScope: z.enum(REPORT_SHARE_SCOPES).optional(),
  schedule: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly"]),
      hour: z.number().int().min(0).max(23),
      day: z.number().int().min(0).max(31).optional(),
      emails: z.array(z.string().email()).max(20),
      enabled: z.boolean(),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select()
        .from(savedReports)
        .where(
          or(
            eq(savedReports.createdById, session.userId),
            // team/tenant-shared reports are visible to all (RLS already scopes
            // to the tenant; finer branch scoping is a follow-on).
            eq(savedReports.sharedScope, "tenant"),
            eq(savedReports.sharedScope, "team")
          )
        )
        .orderBy(desc(savedReports.updatedAt))
        .limit(500)
    );
    // Surface a per-viewer star flag + whether the caller owns each report.
    const reports = rows.map((r) => ({
      ...r,
      starred: ((r.starredBy as string[] | null) ?? []).includes(session.userId),
      isMine: r.createdById === session.userId,
    }));
    return NextResponse.json({ reports });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = ReportBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    // Catalog validation — every referenced field must exist (no injection,
    // no broken reports). Throws a clean message the client can show.
    try {
      assertValidReport(body);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "invalid report definition" }, { status: 400 });
    }

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(savedReports).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        name: body.name,
        description: body.description ?? null,
        subject: body.subject,
        reportType: body.reportType,
        ast: (body.ast ?? null) as any,
        columns: body.columns ?? [],
        sort: body.sort ?? null,
        matrix: body.matrix ?? null,
        summary: body.summary ?? null,
        folder: body.folder ?? null,
        chartType: body.chartType ?? "none",
        sharedScope: body.sharedScope ?? "private",
        schedule: body.schedule ?? null,
        createdById: session.userId,
        starredBy: [],
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.create",
        entityType: "saved_report",
        entityId: id,
        after: { name: body.name, subject: body.subject, reportType: body.reportType },
        ...clientMeta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
