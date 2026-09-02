import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/lead-forms       — list the tenant's forms
 * POST /api/lead-forms       — create a form
 *
 * Owner / marketing-only. Slug is globally unique; if the requested
 * slug is taken, we return 409 with a helpful message.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { leadCaptureForms } from "@/db/schema";
import { normalizeLeadSource } from "@/lib/leads/normalize";

export const dynamic = "force-dynamic";

const FieldSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/i, "key must be alphanumeric + underscores")
    .max(40),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "email", "tel", "number", "select", "textarea"]),
  required: z.boolean().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional(),
  placeholder: z.string().max(120).optional(),
});

const PostBody = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "slug must be 1-60 chars, lowercase a-z, 0-9, hyphen; not leading/trailing -")
    .max(60),
  description: z.string().max(2000).optional(),
  fields: z.array(FieldSchema).max(20).default([]),
  defaultRmId: z.string().uuid().nullable().optional(),
  leadSource: z.string().max(40).default("website"),
  sourceCampaign: z.string().max(120).optional(),
  rateLimitPerHour: z.coerce.number().int().min(1).max(500).optional(),
  branding: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoUrl: z.string().regex(/^\//).or(z.string().url()).optional(),
      thankYouMessage: z.string().max(500).optional(),
      redirectUrl: z.string().url().optional(),
    })
    .optional(),
  enabled: z.boolean().default(true),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.select().from(leadCaptureForms).where(eq(leadCaptureForms.tenantId, session.tenantId));
    });
    return NextResponse.json({ forms: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    try {
      const row = await withTenant(session.tenantId, async (tx) => {
        const [r] = await tx
          .insert(leadCaptureForms)
          .values({
            tenantId: session.tenantId,
            name: parse.data.name,
            slug: parse.data.slug,
            description: parse.data.description,
            fields: parse.data.fields,
            defaultRmId: parse.data.defaultRmId ?? null,
            leadSource: normalizeLeadSource(parse.data.leadSource),
            sourceCampaign: parse.data.sourceCampaign,
            rateLimitPerHour: parse.data.rateLimitPerHour ? String(parse.data.rateLimitPerHour) : undefined,
            branding: parse.data.branding,
            enabled: parse.data.enabled,
            createdBy: session.userId,
          } as any)
          .returning();
        return r;
      });
      return NextResponse.json({ form: row });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("lead_capture_forms_slug_unique")) {
        return NextResponse.json(
          { error: "That slug is already in use. Pick another." },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
