/**
 * WhatsApp conversation API for a single Client (investor) or Lead.
 *
 *   GET  ?type=investor|lead&id=<uuid>
 *        → { messages: [...inbound + outbound, chronological...],
 *            sessionActive: boolean,   // is the 24h reply window open?
 *            templates: [...WhatsApp templates for the picker...] }
 *
 *   POST { type, id, text }                       → free-form reply (in 24h window)
 *   POST { type, id, templateKey, variables }     → approved-template send
 *        Both go through the comms pipeline (consent + session + compliance
 *        gated, audited). Returns the dispatch result.
 *
 * Recipient = the investor's whatsapp_phone (fallback phone), or the lead's phone.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { communications, templates, templateVersions, investors, leads } from "@/db/schema";
import { dispatch, hasActiveWhatsappSession } from "@/lib/comms/pipeline";

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
      const msgRows = await tx
        .select({
          id: communications.id,
          direction: communications.direction,
          status: communications.status,
          statusReason: communications.statusReason,
          templateKey: communications.templateKey,
          payload: communications.payload,
          inboundContent: communications.inboundContent,
          externalId: communications.externalId,
          createdAt: communications.createdAt,
          sentAt: communications.sentAt,
          deliveredAt: communications.deliveredAt,
          readAt: communications.readAt,
          failedAt: communications.failedAt,
        })
        .from(communications)
        .where(
          and(
            eq(communications.tenantId, session.tenantId),
            eq(communications.channel, "whatsapp"),
            entityCond(type, id)
          )
        )
        .orderBy(asc(communications.createdAt))
        .limit(200);

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
        .where(and(eq(templates.tenantId, session.tenantId), eq(templates.channel, "whatsapp")));

      const sessionActive = await hasActiveWhatsappSession(tx, session.tenantId, {
        investorId: type === "investor" ? id : undefined,
        leadId: type === "lead" ? id : undefined,
      });

      return { msgRows, tmplRows, sessionActive };
    });

    const messages = data.msgRows.map((r) => {
      const p = (r.payload ?? {}) as any;
      const inbound = (r.inboundContent ?? {}) as any;
      const text = r.direction === "inbound" ? inbound.text ?? "" : p.rendered?.text ?? p.text ?? "";
      return {
        id: r.id,
        direction: r.direction,
        status: r.status,
        statusReason: r.statusReason ?? null,
        text,
        templateKey: r.templateKey ?? null,
        externalId: r.externalId ?? null,
        createdAt: r.createdAt,
        sentAt: r.sentAt ?? null,
        deliveredAt: r.deliveredAt ?? null,
        readAt: r.readAt ?? null,
        failedAt: r.failedAt ?? null,
      };
    });

    // Flag templates whose stored media-header URL is an expiring Meta CDN URL
    // (Meta 131053) so the composer can warn before a doomed send.
    const EXPIRING_MEDIA = /scontent\.whatsapp\.net|lookaside\.fbsbx\.com/i;
    const tmpls = data.tmplRows.map((t) => {
      const b = (t.body ?? {}) as any;
      const fmt = String(b.headerFormat ?? "").toUpperCase();
      const isMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(fmt);
      const url = b.headerSampleUrl ?? b.headerMediaUrl;
      const mediaBroken =
        b.headerMediaBroken === true || (isMedia && (!url || EXPIRING_MEDIA.test(String(url))));
      // A Meta-approved (Vartify-fetched) template can be sent to anyone, anytime.
      // A CRM-authored one goes as free-form text → delivers only inside the 24h
      // session window.
      // `wainaTemplateName` is the pre-Vartify key — still read so templates stored
      // before the provider switch keep resolving.
      const isMetaTemplate = !!(b.vartifyTemplateName || b.wainaTemplateName || b.metaTemplateName);
      const { body: _omit, ...rest } = t;
      return { ...rest, mediaBroken, isMetaTemplate };
    });

    return NextResponse.json({ messages, sessionActive: data.sessionActive, templates: tmpls });
  } catch (err) {
    return handleApiError(err);
  }
}

const PostBody = z.object({
  type: z.enum(["investor", "lead"]),
  id: z.string().uuid(),
  templateKey: z.string().min(1).optional(),
  variables: z.record(z.string(), z.any()).default({}),
  text: z.string().min(1).max(4096).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { type, id, templateKey, variables, text } = parsed.data;
    if (!templateKey && !text) {
      return NextResponse.json({ error: "Provide either a template or free-form text." }, { status: 400 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      let recipient = "";
      if (type === "investor") {
        const [inv] = await tx
          .select()
          .from(investors)
          .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) throw new Error("Client not found");
        recipient = inv.whatsappPhone || inv.phone || "";
      } else {
        const [ld] = await tx
          .select()
          .from(leads)
          .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)))
          .limit(1);
        if (!ld) throw new Error("Lead not found");
        recipient = ld.phone || "";
      }
      if (!recipient) {
        throw new Error(`No WhatsApp number on file for this ${type === "investor" ? "client" : "lead"}.`);
      }

      // Free-form reply (only valid inside the 24h window — the pipeline enforces).
      if (text && !templateKey) {
        return dispatch(tx, {
          tenantId: session.tenantId,
          channel: "whatsapp",
          freeformText: text,
          recipient,
          variables: {},
          category: "utility",
          investorId: type === "investor" ? id : undefined,
          leadId: type === "lead" ? id : undefined,
        });
      }

      // Template send.
      const [tmpl] = await tx
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.key, templateKey!),
            eq(templates.channel, "whatsapp")
          )
        )
        .limit(1);
      if (!tmpl) throw new Error(`WhatsApp template '${templateKey}' not found`);

      return dispatch(tx, {
        tenantId: session.tenantId,
        channel: "whatsapp",
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
    // Surface the real WhatsApp/Vartify failure (e.g. a provider rejection) to the
    // sender instead of a generic "internal" — these messages aren't sensitive
    // and the RM needs to see why a send didn't go out.
    const msg = String(err?.message ?? "");
    if (/whatsapp|ssit|template|phone|contact/i.test(msg)) {
      return NextResponse.json({ error: msg.replace(/^SSIT WhatsApp send failed:\s*/i, "WhatsApp: ") }, { status: 502 });
    }
    return handleApiError(err);
  }
}
