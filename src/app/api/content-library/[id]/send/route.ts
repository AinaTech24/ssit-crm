import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { dispatch } from "@/lib/comms/pipeline";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { assetVisibleTo } from "@/lib/content/asset-url";
import {
  contentLibraryAssets,
  contentLibraryEvents,
  investors,
  leads,
  templates,
  templateVersions,
  tenants,
} from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const body = await req.json().catch(() => ({}));

    const {
      recipientType, // "investor" | "lead"
      recipientId,
      channel, // "whatsapp" | "email"
      customNote,
      position = "bottom",
      heightPct = 18,
      variant = "solid",
      size = "original",
      frameTheme,
    } = body;

    if (!recipientType || !recipientId || !channel) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    if (recipientType !== "investor" && recipientType !== "lead") {
      return NextResponse.json({ error: "invalid recipient type" }, { status: 400 });
    }

    if (channel !== "email" && channel !== "whatsapp") {
      return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // 1. Fetch Tenant details
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1);
      if (!tenant) throw new Error("Tenant not found");

      // 2. Fetch Asset — global OR caller's own. Explicit predicate (the table
      //    has no single-tenant RLS policy, so withTenant alone wouldn't scope it).
      const [asset] = await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, assetId), assetVisibleTo(session.tenantId)))
        .limit(1);
      if (!asset) throw new Error("Asset not found or access denied");

      // 3. Fetch Recipient
      let recipient: { name: string; email: string | null; phone: string | null; whatsappPhone?: string | null } | null = null;
      if (recipientType === "investor") {
        const [inv] = await tx
          .select()
          .from(investors)
          .where(eq(investors.id, recipientId))
          .limit(1);
        recipient = inv ? { name: inv.name, email: inv.email, phone: inv.phone, whatsappPhone: inv.whatsappPhone } : null;
      } else {
        const [ld] = await tx
          .select()
          .from(leads)
          .where(eq(leads.id, recipientId))
          .limit(1);
        recipient = ld ? { name: ld.name, email: ld.email, phone: ld.phone } : null;
      }

      if (!recipient) throw new Error("Recipient client not found");

      const contactTarget = channel === "email" ? recipient.email : (recipient.whatsappPhone ?? recipient.phone);
      if (!contactTarget) {
        throw new Error(`Recipient has no contact details for the selected channel (${channel})`);
      }

      // 4. Ensure Template exists for the chosen channel
      let [tmpl] = await tx
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.key, "share_asset"),
            eq(templates.channel, channel)
          )
        );

      if (!tmpl) {
        const tplId = uuid();
        const verId = uuid();

        const templateBody = channel === "email"
          ? {
              subject: "Shared Update: {{asset_title}}",
              blocks: [
                {
                  type: "text",
                  text: "Hi {{name}},\n\n{{custom_note}}\n\nYou can view/download the update here:\n{{asset_url}}\n\nBest regards,\n{{tenant_display_name}}"
                }
              ]
            }
          : {
              vartifyTemplateName: "share_asset",
              text: "Hi {{name}}, here is the asset: {{asset_title}} ({{asset_url}})."
            };

        const templateVariables = channel === "email"
          ? [
              { key: "name", type: "string" },
              { key: "custom_note", type: "string" },
              { key: "asset_title", type: "string" },
              { key: "asset_url", type: "url" },
              { key: "tenant_display_name", type: "string" }
            ]
          : [
              { key: "name", type: "string" },
              { key: "asset_title", type: "string" },
              { key: "asset_url", type: "url" }
            ];

        // Run the REAL compliance checker on the static body instead of
        // self-blessing with a hardcoded 100. Email needs no Meta approval, so
        // it can auto-approve; WhatsApp templates require Meta/Vartify approval,
        // so we create them as pending_approval — dispatch() will then surface
        // an auditable "template_not_approved" skip rather than firing an
        // unreviewed WhatsApp template.
        const scanText =
          channel === "email"
            ? `${(templateBody as any).subject ?? ""} ${(templateBody as any).blocks?.[0]?.text ?? ""}`
            : (templateBody as any).text ?? "";
        const [tn] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
        const compliance = runComplianceChecks({
          channel: channel === "email" ? "email" : "whatsapp",
          category: "utility",
          tenant: { legalName: (tn as any)?.legalName, arn: (tn as any)?.arn, principalEuin: (tn as any)?.principalEuin ?? undefined, riaRegistered: (tn as any)?.riaRegistered ?? false },
          text: scanText,
        });
        if (compliance.blocked) {
          return NextResponse.json(
            { error: "Share template failed compliance", findings: compliance.findings },
            { status: 422 }
          );
        }
        const tmplStatus = channel === "email" ? "approved" : "pending_approval";

        await tx.insert(templates).values({
          id: tplId,
          tenantId: session.tenantId,
          key: "share_asset",
          channel,
          name: channel === "email" ? "Share Content Asset (Email)" : "Share Content Asset (WhatsApp)",
          description: "System template for sharing content library assets",
          category: "utility",
          status: tmplStatus,
          currentVersionId: verId,
        } as any);

        await tx.insert(templateVersions).values({
          id: verId,
          templateId: tplId,
          tenantId: session.tenantId,
          versionNumber: 1,
          body: templateBody,
          variables: templateVariables,
          approvalStatus: channel === "email" ? "approved_internal" : "draft",
          complianceScore: String(compliance.score),
        } as any);

        // Re-read so the (possibly pending) template flows into dispatch() below.
        [tmpl] = await tx
          .select()
          .from(templates)
          .where(and(eq(templates.tenantId, session.tenantId), eq(templates.key, "share_asset"), eq(templates.channel, channel)));
      }

      // 5. Build branded absolute asset link
      const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
      const assetUrl = asset.type === "image"
        ? `${baseUrl}/api/content-library/${asset.id}/branded?mode=download&position=${position}&h=${heightPct}&variant=${variant}&size=${size}${frameTheme ? `&frametheme=${frameTheme}` : ""}`
        : `${baseUrl}${asset.fileUrl}`;

      // 6. Dispatch
      const dispatchInput = {
        tenantId: session.tenantId,
        channel,
        templateKey: "share_asset",
        recipient: contactTarget,
        variables: {
          name: recipient.name,
          custom_note: customNote || "Please find the attached update.",
          asset_title: asset.title,
          asset_url: assetUrl,
          tenant_display_name: tenant.displayName ?? tenant.legalName,
        },
        category: "utility" as const,
        investorId: recipientType === "investor" ? recipientId : undefined,
        leadId: recipientType === "lead" ? recipientId : undefined,
      };

      const sent = await dispatch(tx, dispatchInput);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "content_asset.share",
        entityType: "content_library_asset",
        entityId: assetId,
        after: { recipientType, recipientId, channel, assetTitle: asset.title },
        ...clientMeta,
      });
      // Usage analytics — record the send (with channel) for the admin library stats.
      await tx.insert(contentLibraryEvents).values({
        assetId,
        tenantId: session.tenantId,
        userId: session.userId,
        eventType: "send",
        channel,
      } as any);
      return sent;
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
