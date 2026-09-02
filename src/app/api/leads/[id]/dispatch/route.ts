/**
 * Template sends for a LEAD — the mirror of /api/investors/[id]/dispatch.
 *
 *   GET  /api/leads/[id]/dispatch  → approved templates the RM can pick from
 *   POST /api/leads/[id]/dispatch  → send one through the comms pipeline
 *                                    (consent + compliance gated, audited)
 *
 * Leads previously had NO template path at all: an RM could send an approved
 * template to an existing client but not to a prospect — which is backwards,
 * since prospects are exactly who you're trying to convert.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { templates, templateVersions, leads } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const data = await withTenant(session.tenantId, async (tx) => {
      const [lead] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)))
        .limit(1);
      if (!lead) throw new Error("Lead not found");

      return tx
        .select({
          id: templates.id,
          key: templates.key,
          channel: templates.channel,
          name: templates.name,
          description: templates.description,
          category: templates.category,
          variables: templateVersions.variables,
        })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(and(eq(templates.tenantId, session.tenantId), eq(templates.status, "approved")));
    });

    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const PostBody = z.object({
  channel: z.enum(["whatsapp", "email", "sms"]),
  templateKey: z.string(),
  variables: z.record(z.string(), z.any()).default({}),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Messaging a prospect is a lead-facing action — gate it the same way an
    // edit to the lead would be.
    requireCap(session.roles, "lead.edit.assigned", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { channel, templateKey, variables } = parsed.data;

    // Bad input is the caller's problem, not a server fault — resolve first and
    // map to a real status code, rather than throwing into a generic 500.
    const result = await withTenant(session.tenantId, async (tx) => {
      const [lead] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)))
        .limit(1);
      if (!lead) return { error: "Lead not found", status: 404 } as const;

      // A lead has a single phone/email — no separate WhatsApp number.
      const recipient = channel === "email" ? (lead.email ?? "") : (lead.phone ?? "");
      if (!recipient) {
        return { error: `This lead has no ${channel === "email" ? "email address" : "phone number"} on file.`, status: 400 } as const;
      }

      const [tmpl] = await tx
        .select()
        .from(templates)
        .where(and(
          eq(templates.tenantId, session.tenantId),
          eq(templates.key, templateKey),
          eq(templates.channel, channel),
        ))
        .limit(1);
      if (!tmpl) {
        return { error: `No approved ${channel} template '${templateKey}'.`, status: 404 } as const;
      }

      const sent = await dispatch(tx, {
        tenantId: session.tenantId,
        channel,
        templateKey,
        recipient,
        variables,
        category: tmpl.category,
        leadId: id,
      });
      return { sent } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.sent);
  } catch (err: any) {
    return handleApiError(err);
  }
}
