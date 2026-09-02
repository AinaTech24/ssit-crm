import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { renderEmailHtml } from "@/lib/email-designer/render";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { MERGE_FIELDS } from "@/lib/email-designer/merge-fields";

export const dynamic = "force-dynamic";

/** Build a sample-data envelope so the preview shows realistic merge values. */
function buildPreviewVariables(): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const f of MERGE_FIELDS) {
    const [root, ...rest] = f.token.split(".");
    out[root] ??= {};
    let cur: any = out[root];
    for (let i = 0; i < rest.length - 1; i++) {
      cur[rest[i]] ??= {};
      cur = cur[rest[i]];
    }
    cur[rest[rest.length - 1]] = f.example;
  }
  return out;
}

/** The tenants.address column is a structured JSON object; the email footer
 *  wants a single line. Flatten it (or pass a plain string through). */
function formatTenantAddress(addr: unknown): string | null {
  if (!addr) return null;
  if (typeof addr === "string") return addr.trim() || null;
  if (typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    const parts = [a.line1, a.line2, a.city, a.state, a.pincode]
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Rendering a preview is READ-ONLY: it renders content the caller just typed,
    // using branding they can already see. Gating it behind `template.edit`
    // (granted only to `marketing`) 403'd every other staff role — even though
    // the Templates nav item has no role restriction, so they can all open the
    // designer. Mirror the read gate used by GET /api/templates instead, and
    // pass `session.permissions` so custom per-user grants are honoured (they
    // are additive grants — dropping the argument silently ignored them).
    requireAny(
      session.roles,
      ["template.view", "template.edit", "communication.send", "workflow.edit"],
      session.permissions
    );
    const { body } = await req.json().catch(() => ({ body: null }));
    if (!body) return NextResponse.json({ error: "missing body" }, { status: 400 });

    // Branding context for the preview. This is best-effort: a live preview must
    // never hard-fail just because the tenant row can't be read. We also select
    // ONLY the columns the preview actually needs — `select().from(tenants)`
    // emits an explicit column list, so a single drifted/newly-added column
    // (e.g. a fresh migration not yet applied) would otherwise 500 the whole
    // preview. Narrowing keeps it resilient to unrelated schema changes.
    let tenant:
      | {
          legalName: string | null;
          displayName: string | null;
          arn: string | null;
          principalEuin: string | null;
          address: unknown;
          website: string | null;
          primaryColor: string | null;
          logoUrl: string | null;
        }
      | null = null;
    try {
      tenant = await withTenant(session.tenantId, async (tx) => {
        const [t] = await tx
          .select({
            legalName: tenants.legalName,
            displayName: tenants.displayName,
            arn: tenants.arn,
            principalEuin: tenants.principalEuin,
            address: tenants.address,
            website: tenants.website,
            primaryColor: tenants.primaryColor,
            logoUrl: tenants.logoUrl,
          })
          .from(tenants)
          .where(eq(tenants.id, session.tenantId));
        return t ?? null;
      });
    } catch (e) {
      // Fall back to an unbranded render rather than failing the preview.
      console.error("[email-preview] tenant branding fetch failed; rendering unbranded:", e);
    }

    const sample = buildPreviewVariables();
    const html = renderEmailHtml(body as EmailDesignerBody, {
      variables: sample,
      tenant: {
        legalName: tenant?.legalName,
        displayName: tenant?.displayName,
        arn: tenant?.arn,
        principalEuin: tenant?.principalEuin,
        address: formatTenantAddress(tenant?.address),
        websiteUrl: tenant?.website ?? null,
        brandColor: tenant?.primaryColor ?? null,
        logoUrl: tenant?.logoUrl ?? null,
      },
      unsubscribeUrl: "#preview",
      previewMarkers: true,
    });
    return NextResponse.json({ html });
  } catch (err: any) {
    // A forbidden capability carries status 403; everything else is a genuine
    // render/server error. Either way, return JSON so the designer shows a
    // helpful message instead of a bare 500 with no context.
    const status = typeof err?.status === "number" ? err.status : 500;
    console.error("[email-preview] preview failed:", err);
    return NextResponse.json({ error: err?.message ?? "preview failed" }, { status });
  }
}
