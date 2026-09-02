import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/content-library/[id]/send-bulk
 *
 * Broadcast a co-branded content asset to many recipients in one go — either a
 * saved SEGMENT (resolved from its active memberships) or an explicit list of
 * investors/leads. Each recipient goes through the same dispatch() funnel as the
 * 1:1 send, so consent, the compliance gate, the WhatsApp session window, and
 * the per-tenant message quota are all honoured PER RECIPIENT. Returns a
 * per-recipient outcome rollup.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { dispatch } from "@/lib/comms/pipeline";
import { assetVisibleTo } from "@/lib/content/asset-url";
import { ensureShareTemplate } from "@/lib/content/share-template";
import { contentLibraryAssets, contentLibraryEvents, investors, leads, segmentMemberships, tenants } from "@/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_RECIPIENTS = 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: assetId } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const body = await req.json().catch(() => ({}));

    const {
      segmentId,
      recipients, // [{ type: "investor"|"lead", id }]
      channel,
      customNote,
      position = "bottom",
      heightPct = 18,
      variant = "solid",
      size = "original",
      frameTheme,
    } = body as any;

    if (channel !== "email" && channel !== "whatsapp") {
      return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    }
    if (!segmentId && !(Array.isArray(recipients) && recipients.length)) {
      return NextResponse.json({ error: "provide a segmentId or a recipients list" }, { status: 400 });
    }

    const out = await withTenant(session.tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      if (!tenant) throw new Error("Tenant not found");

      const [asset] = await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, assetId), assetVisibleTo(session.tenantId)))
        .limit(1);
      if (!asset) throw Object.assign(new Error("Asset not found or access denied"), { status: 404 });

      // ── Resolve the recipient set ────────────────────────────────────────
      // Segment → its active investor memberships; else the explicit list.
      let targets: Array<{ type: "investor" | "lead"; id: string }> = [];
      if (segmentId) {
        const rows = await tx
          .select({ id: segmentMemberships.subjectId })
          .from(segmentMemberships)
          .where(and(eq(segmentMemberships.segmentId, segmentId), eq(segmentMemberships.tenantId, session.tenantId), isNull(segmentMemberships.removedAt)))
          .limit(MAX_RECIPIENTS);
        targets = rows.map((r) => ({ type: "investor" as const, id: r.id }));
      } else {
        targets = (recipients as any[])
          .filter((r) => (r?.type === "investor" || r?.type === "lead") && typeof r?.id === "string")
          .slice(0, MAX_RECIPIENTS)
          .map((r) => ({ type: r.type, id: r.id }));
      }
      if (targets.length === 0) return { total: 0, sent: 0, skipped: 0, failed: 0, errors: [] as any[] };

      // Bulk-load contact details for the two subject types.
      const invIds = targets.filter((t) => t.type === "investor").map((t) => t.id);
      const leadIds = targets.filter((t) => t.type === "lead").map((t) => t.id);
      const invMap = new Map<string, any>();
      const leadMap = new Map<string, any>();
      if (invIds.length) {
        for (const r of await tx.select().from(investors).where(inArray(investors.id, invIds))) invMap.set(r.id, r);
      }
      if (leadIds.length) {
        for (const r of await tx.select().from(leads).where(inArray(leads.id, leadIds))) leadMap.set(r.id, r);
      }

      // Ensure the share template exists once (compliance-checked).
      await ensureShareTemplate(tx, session.tenantId, channel);

      const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
      const assetUrl =
        asset.type === "image"
          ? `${baseUrl}/api/content-library/${asset.id}/branded?mode=download&position=${position}&h=${heightPct}&variant=${variant}&size=${size}${frameTheme ? `&frametheme=${frameTheme}` : ""}`
          : `${baseUrl}${asset.fileUrl}`;
      const displayName = tenant.displayName ?? tenant.legalName;

      let sent = 0, skipped = 0, failed = 0;
      const errors: Array<{ id: string; reason: string }> = [];

      for (const t of targets) {
        const rec = t.type === "investor" ? invMap.get(t.id) : leadMap.get(t.id);
        if (!rec) { failed++; errors.push({ id: t.id, reason: "recipient not found" }); continue; }
        const contactTarget = channel === "email" ? rec.email : (rec.whatsappPhone ?? rec.phone);
        if (!contactTarget) { skipped++; errors.push({ id: t.id, reason: `no ${channel} contact` }); continue; }

        try {
          const res = await dispatch(tx, {
            tenantId: session.tenantId,
            channel,
            templateKey: "share_asset",
            recipient: contactTarget,
            variables: {
              name: rec.name,
              custom_note: customNote || "Please find the attached update.",
              asset_title: asset.title,
              asset_url: assetUrl,
              tenant_display_name: displayName,
            },
            category: "utility" as const,
            investorId: t.type === "investor" ? t.id : undefined,
            leadId: t.type === "lead" ? t.id : undefined,
          });
          // dispatch returns a status; a consent/compliance/quota skip is a
          // recorded "skipped_*" outcome, not an error.
          const st = String((res as any)?.status ?? "queued");
          if (st.startsWith("skipped")) { skipped++; errors.push({ id: t.id, reason: st }); }
          else sent++;
        } catch (e: any) {
          failed++;
          errors.push({ id: t.id, reason: String(e?.message ?? "send failed").slice(0, 160) });
        }
      }

      await tx.insert(contentLibraryEvents).values({
        assetId, tenantId: session.tenantId, userId: session.userId, eventType: "send", channel,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "content_asset.bulk_share",
        entityType: "content_library_asset",
        entityId: assetId,
        after: { channel, segmentId: segmentId ?? null, total: targets.length, sent, skipped, failed, assetTitle: asset.title },
        ...clientMeta,
      });

      return { total: targets.length, sent, skipped, failed, errors: errors.slice(0, 50) };
    });

    return NextResponse.json({ success: true, ...out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
