import { handleApiError } from "@/lib/api/error-handler";
/**
 * Templates collection.
 *
 *   GET  /api/templates           — list templates in tenant
 *   POST /api/templates           — create new template + draft version 1
 *
 * Every save runs the compliance gate; the result is snapshotted on the version.
 * Marketing-category templates need explicit human approval before they can send.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { tenants, templates, templateVersions } from "@/db/schema";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { findUndeclaredPlaceholders, templateBodyToText } from "@/lib/comms/tokens";

export const dynamic = "force-dynamic";

const VariableDecl = z.object({
  key: z.string(),
  type: z.enum(["string", "number", "currency", "date", "boolean", "url"]),
  source: z.string().optional(),
  required: z.boolean().optional(),
  fallback: z.any().optional(),
  format: z.string().optional(),
});

const CreateBody = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/, "lowercase, underscore, numbers only"),
  channel: z.enum(["whatsapp", "email", "sms", "inapp"]),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  category: z.enum(["transactional", "utility", "marketing", "authentication"]).default("transactional"),
  locale: z.string().default("en-IN"),
  body: z.any(),
  variables: z.array(VariableDecl).default([]),
  attachments: z.array(z.object({ name: z.string().max(200), url: z.string().max(2000) })).default([]),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["template.view", "template.edit", "communication.send", "workflow.edit"], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(templates)
        .where(eq(templates.tenantId, session.tenantId))
        .orderBy(desc(templates.updatedAt));
    });
    return NextResponse.json({ templates: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Creation is firm-admin only (see template.create in rbac.ts). Editing an
    // existing template still runs on template.edit.
    requireCap(session.roles, "template.create", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const tplId = uuid();
    const verId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      // Fetch tenant for compliance context
      const tenant = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const t = tenant[0];

      // Render plain text for compliance scan (shared extractor — see tokens.ts)
      const previewText = templateBodyToText(body.channel, body.body);
      const subject = body.channel === "email" ? (body.body?.subject ?? "") : undefined;
      const dltTemplateId = body.channel === "sms" ? body.body?.dltTemplateId : undefined;

      const compliance = runComplianceChecks({
        channel: body.channel as any,
        category: body.category as any,
        tenant: {
          legalName: t?.legalName ?? "",
          arn: t?.arn ?? "",
          principalEuin: t?.principalEuin ?? undefined,
          riaRegistered: t?.riaRegistered ?? false,
        },
        text: previewText,
        subject,
        dltTemplateId,
      });

      // Auto-resolve a colliding key (tenant, channel, locale) by appending _2,
      // _3… so saving never fails on a default key like "new_template". Templates
      // are low-cardinality per tenant, so reading the existing keys is cheap.
      const existingKeys = await tx
        .select({ key: templates.key })
        .from(templates)
        .where(and(eq(templates.tenantId, session.tenantId), eq(templates.channel, body.channel), eq(templates.locale, body.locale)));
      const taken = new Set(existingKeys.map((r) => r.key));
      let key = body.key;
      if (taken.has(key)) {
        let n = 2;
        while (taken.has(`${key}_${n}`)) n++;
        key = `${key}_${n}`;
      }

      await tx.insert(templates).values({
        id: tplId,
        tenantId: session.tenantId,
        key,
        channel: body.channel,
        name: body.name,
        description: body.description,
        category: body.category,
        locale: body.locale,
        status: "draft",
        currentVersionId: verId,
      } as any);

      await tx.insert(templateVersions).values({
        id: verId,
        templateId: tplId,
        tenantId: session.tenantId,
        versionNumber: 1,
        body: body.body,
        variables: body.variables,
        attachments: body.attachments ?? [],
        complianceChecks: compliance,
        complianceScore: String(compliance.score),
        autoComplianceBlocked: compliance.blocked,
        approvalStatus: "draft",
        createdByUserId: session.userId,
      } as any);

      // Non-blocking authoring hint: merge fields used in the body but not
      // declared as variables will render blank at send.
      const undeclared = findUndeclaredPlaceholders(previewText, body.variables.map((v) => v.key));
      const warnings = undeclared.length
        ? [`Undeclared merge fields will render blank: ${undeclared.map((k) => `{{${k}}}`).join(", ")}`]
        : [];

      return { id: tplId, versionId: verId, key, compliance, warnings };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    // (compliance text extraction lives in tokens.ts — templateBodyToText)
    // Postgres unique_violation = 23505. Drizzle wraps the driver error, so the
    // constraint name lives on err.cause/err.detail, NOT err.message ("Failed
    // query: …"). Check the code + all message surfaces so a duplicate key is a
    // friendly 409 instead of a masked 500 "internal".
    const code = err?.code ?? err?.cause?.code;
    const surfaces = `${err?.message ?? ""} ${err?.cause?.message ?? ""} ${err?.cause?.detail ?? ""} ${err?.detail ?? ""} ${err?.cause?.constraint ?? ""}`;
    if (
      code === "23505" ||
      surfaces.includes("templates_tenant_key_channel_locale_unique") ||
      /duplicate key|unique constraint/i.test(surfaces)
    ) {
      return NextResponse.json(
        { error: "A template with this key already exists for this channel + locale. Change the key (the field under the title) and try again." },
        { status: 409 }
      );
    }
    return handleApiError(err);
  }
}
