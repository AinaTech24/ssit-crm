/**
 * Emails related-list API for a single Client (investor) or Lead.
 *
 *   GET  ?type=investor|lead&id=<uuid>
 *        → { emails: [...sent emails with status + rendered content...],
 *            templates: [...approved email templates for the picker...] }
 *
 *   POST { type, id, templateKey, variables }
 *        → sends the chosen template to the entity's email via the comms
 *          pipeline (consent + compliance gated, audited). Returns the
 *          dispatch result ({ communicationId, status, skipped? }).
 *
 * Self-contained so it doesn't touch the existing investor/lead routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { communications, templates, templateVersions, investors, leads, users } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";
import { composeAndSendEmail } from "@/lib/comms/compose";
import { findUndeclaredPlaceholders } from "@/lib/comms/tokens";

export const dynamic = "force-dynamic";

function entityCond(type: "investor" | "lead", id: string) {
  return type === "investor" ? eq(communications.investorId, id) : eq(communications.leadId, id);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id") ?? "";
    if ((type !== "investor" && type !== "lead") || !id) {
      return NextResponse.json({ error: "type (investor|lead) + id required" }, { status: 400 });
    }

    const data = await withTenant(session.tenantId, async (tx) => {
      const emailRows = await tx
        .select({
          id: communications.id,
          direction: communications.direction,
          status: communications.status,
          statusReason: communications.statusReason,
          templateKey: communications.templateKey,
          payload: communications.payload,
          inboundContent: communications.inboundContent,
          externalId: communications.externalId,
          threadId: communications.threadId,
          createdAt: communications.createdAt,
          sentAt: communications.sentAt,
          deliveredAt: communications.deliveredAt,
          failedAt: communications.failedAt,
        })
        .from(communications)
        .where(
          and(
            eq(communications.tenantId, session.tenantId),
            eq(communications.channel, "email"),
            // Both inbound + outbound → a true two-way conversation on the record.
            entityCond(type, id)
          )
        )
        .orderBy(desc(communications.createdAt))
        .limit(100);

      const tmplRows = await tx
        .select({
          key: templates.key,
          name: templates.name,
          description: templates.description,
          category: templates.category,
          status: templates.status,
          variables: templateVersions.variables,
          body: templateVersions.body,
        })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.channel, "email")
            // Show ALL of the firm's email templates (draft/pending/approved) so
            // a just-created one is visible. The send still passes the comms gate
            // — an unapproved template is reported back as skipped on send.
          )
        );

      return { emailRows, tmplRows };
    });

    const emails = data.emailRows.map((r) => {
      if (r.direction === "inbound") {
        const ic = (r.inboundContent ?? {}) as any;
        return {
          id: r.id,
          direction: "inbound" as const,
          status: r.status,
          statusReason: r.statusReason ?? null,
          subject: ic.subject ?? "(no subject)",
          text: ic.text ?? (ic.html ? "(HTML email — open to view)" : ""),
          from: ic.from ?? ic.fromName ?? null,
          templateKey: null,
          externalId: r.externalId ?? null,
          threadId: r.threadId ?? null,
          createdAt: r.createdAt,
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
        };
      }
      const p = (r.payload ?? {}) as any;
      const rendered = p.rendered ?? {};
      return {
        id: r.id,
        direction: "outbound" as const,
        status: r.status,
        statusReason: r.statusReason ?? null,
        subject: rendered.subject ?? p.subject ?? "(no subject)",
        text: rendered.text ?? p.text ?? "",
        from: null,
        templateKey: r.templateKey ?? null,
        externalId: r.externalId ?? null,
        threadId: r.threadId ?? null,
        createdAt: r.createdAt,
        sentAt: r.sentAt ?? null,
        deliveredAt: r.deliveredAt ?? null,
        failedAt: r.failedAt ?? null,
      };
    });

    // Surface EVERY merge field the template body actually uses — not just the
    // declared `variables` array. The designer's auto-extraction can miss fields
    // tucked inside data_table / button blocks, which then never get prompted in
    // the compose modal. Scanning the body JSON catches them; each template thus
    // prompts for its OWN fields. findUndeclaredPlaceholders drops system/footer
    // tokens (logo, ARN, address) and positional params for us.
    const templatesOut = data.tmplRows.map((t) => {
      const declared = Array.isArray(t.variables) ? (t.variables as any[]) : [];
      const declaredKeys = declared.map((v) => v.key);
      const extraKeys = findUndeclaredPlaceholders(JSON.stringify(t.body ?? {}), declaredKeys);
      const extra = extraKeys.map((key) => ({ key, type: "string", required: false }));
      return {
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        status: t.status,
        variables: [...declared, ...extra],
      };
    });

    return NextResponse.json({ emails, templates: templatesOut });
  } catch (err) {
    return handleApiError(err);
  }
}

const PostBody = z.discriminatedUnion("mode", [
  // Template send (existing behaviour). `mode` is defaulted to "template" by the
  // handler before parsing, so the discriminator is always present.
  z.object({
    mode: z.literal("template"),
    type: z.enum(["investor", "lead"]),
    id: z.string().uuid(),
    templateKey: z.string().min(1),
    variables: z.record(z.string(), z.any()).default({}),
  }),
  // Free-form reply / forward (still compliance + consent gated via compose).
  z.object({
    mode: z.literal("compose"),
    type: z.enum(["investor", "lead"]),
    id: z.string().uuid(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    /** Forward override — send to a different address than the record's. */
    to: z.string().email().optional(),
    /** Thread + parent message this is a reply to. */
    threadId: z.string().uuid().optional(),
    inReplyTo: z.string().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const raw = await req.json().catch(() => ({}));
    if (raw && raw.mode === undefined) raw.mode = "template"; // back-compat
    const parsed = PostBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const data = parsed.data;
    const { type, id } = data;

    // ── Free-form reply / forward ──────────────────────────────────────────
    if (data.mode === "compose") {
      const result = await withTenant(session.tenantId, async (tx) => {
        let recipient = data.to ?? "";
        let recipientName: string | null = null;
        if (type === "investor") {
          const [inv] = await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId))).limit(1);
          if (!inv) throw new Error("Client not found");
          recipient = recipient || (inv.email ?? "");
          recipientName = inv.name ?? null;
        } else {
          const [ld] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).limit(1);
          if (!ld) throw new Error("Lead not found");
          recipient = recipient || (ld.email ?? "");
          recipientName = ld.name ?? null;
        }
        if (!recipient) throw new Error("No recipient email address.");

        // Reply-To = the sending RM's own email so the client's reply lands in
        // their inbox (per-RM routing on a shared firm mailbox).
        const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, session.userId)).limit(1);

        return composeAndSendEmail(tx, {
          tenantId: session.tenantId,
          subject: data.subject,
          body: data.body,
          category: "transactional",
          recipient,
          recipientName,
          investorId: type === "investor" ? id : null,
          leadId: type === "lead" ? id : null,
          actorUserId: session.userId,
          threadId: data.threadId ?? null,
          inReplyTo: data.inReplyTo ?? null,
          replyTo: me?.email ?? null,
        });
      });
      return NextResponse.json(result);
    }

    const { templateKey, variables } = data;
    const result = await withTenant(session.tenantId, async (tx) => {
      let recipient = "";
      if (type === "investor") {
        const [inv] = await tx
          .select()
          .from(investors)
          .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) throw new Error("Client not found");
        recipient = inv.email ?? "";
      } else {
        const [ld] = await tx
          .select()
          .from(leads)
          .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)))
          .limit(1);
        if (!ld) throw new Error("Lead not found");
        recipient = ld.email ?? "";
      }
      if (!recipient) {
        throw new Error(`No email address on file for this ${type === "investor" ? "client" : "lead"}.`);
      }

      const [tmpl] = await tx
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.key, templateKey),
            eq(templates.channel, "email")
          )
        )
        .limit(1);
      if (!tmpl) throw new Error(`Email template '${templateKey}' not found`);

      return dispatch(tx, {
        tenantId: session.tenantId,
        channel: "email",
        templateKey,
        recipient,
        variables,
        category: tmpl.category as any,
        investorId: type === "investor" ? id : undefined,
        leadId: type === "lead" ? id : undefined,
      });
    });

    return NextResponse.json(result);
  } catch (err: any) {
    // Turn a cryptic send failure into something the user can act on instead of
    // a masked "internal" — the usual cause is no/broken mailbox connection.
    const m = String(err?.message ?? "");
    if (/RESEND_API_KEY not set|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|self.signed|certificate|no .*sender|mailbox/i.test(m)) {
      return NextResponse.json(
        { error: "Couldn't send — your email mailbox isn't connected or its login/SMTP failed. Connect & test it under Settings → Integrations → Mailbox, then retry." },
        { status: 422 }
      );
    }
    return handleApiError(err);
  }
}
