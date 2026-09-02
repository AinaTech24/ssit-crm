/**
 * GET   /api/tenant/domain  — current white-label host config + status.
 * PATCH /api/tenant/domain  — set/clear the firm's vanity subdomain and/or
 *                             custom domain. Owner-only.
 * POST  /api/tenant/domain/verify is a separate action folded in here as
 *   PATCH { action: "verify" } — re-checks the custom domain's DNS and stamps
 *   custom_domain_verified_at once it points at us.
 *
 * Subdomain: any plan. Custom domain: intended as a premium add-on — gate via
 * packages.feature_flags if desired (left open here so the operator can enable).
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { tenants } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";
import { appBaseDomain, normalizeHost, RESERVED_SUBDOMAINS, canonicalHostForTenant } from "@/lib/tenant/host";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.literal("verify").optional(),
  // "" clears the value; a string sets it. Undefined = leave as-is.
  subdomain: z.string().trim().toLowerCase().max(40).optional(),
  customDomain: z.string().trim().toLowerCase().max(253).optional(),
});

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/; // 3–40 chars, no leading/trailing hyphen
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** True if `host` resolves (CNAME or A) to the base domain / our apex. */
async function pointsToUs(host: string): Promise<boolean> {
  const base = appBaseDomain();
  try {
    const cnames = await dns.resolveCname(host).catch(() => [] as string[]);
    if (cnames.some((c) => normalizeHost(c) === base || normalizeHost(c).endsWith(`.${base}`))) return true;
  } catch { /* ignore */ }
  try {
    const [baseA, hostA] = await Promise.all([
      dns.resolve4(base).catch(() => [] as string[]),
      dns.resolve4(host).catch(() => [] as string[]),
    ]);
    if (hostA.length && baseA.length && hostA.some((ip) => baseA.includes(ip))) return true;
  } catch { /* ignore */ }
  return false;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const t = await withTenant(session.tenantId, async (tx) =>
      (await tx.select({
        subdomain: tenants.subdomain,
        customDomain: tenants.customDomain,
        customDomainVerifiedAt: tenants.customDomainVerifiedAt,
      }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0]
    );
    const base = appBaseDomain();
    return NextResponse.json({
      baseDomain: base,
      subdomain: t?.subdomain ?? null,
      subdomainHost: t?.subdomain ? `${t.subdomain}.${base}` : null,
      customDomain: t?.customDomain ?? null,
      customDomainVerified: !!t?.customDomainVerifiedAt,
      canonicalHost: canonicalHostForTenant(t ?? {}),
      // The CNAME target the firm must point their custom domain at.
      cnameTarget: base,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const data = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const base = appBaseDomain();

    // ── Re-verify the existing custom domain's DNS ──
    if (data.action === "verify") {
      const cur = await withTenant(session.tenantId, async (tx) =>
        (await tx.select({ customDomain: tenants.customDomain }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0]
      );
      if (!cur?.customDomain) return NextResponse.json({ error: "No custom domain set." }, { status: 400 });
      const ok = await pointsToUs(cur.customDomain);
      await withTenant(session.tenantId, async (tx) => {
        await tx.update(tenants).set({ customDomainVerifiedAt: ok ? new Date() : null, updatedAt: new Date() } as any).where(eq(tenants.id, session.tenantId));
      });
      return NextResponse.json({ verified: ok, cnameTarget: base, message: ok ? "Domain verified." : `Not pointing to ${base} yet. Add a CNAME record and try again (DNS can take a few minutes).` });
    }

    // ── Validate + set subdomain / custom domain ──
    const set: Record<string, any> = { updatedAt: new Date() };

    if (data.subdomain !== undefined) {
      const s = data.subdomain;
      if (s === "") {
        set.subdomain = null;
      } else {
        if (!SUBDOMAIN_RE.test(s)) return NextResponse.json({ error: "Subdomain must be 3–40 letters/numbers/hyphens (no leading or trailing hyphen)." }, { status: 400 });
        if (RESERVED_SUBDOMAINS.has(s)) return NextResponse.json({ error: `"${s}" is reserved — pick another.` }, { status: 400 });
        set.subdomain = s;
      }
    }

    if (data.customDomain !== undefined) {
      const d = normalizeHost(data.customDomain);
      if (d === "") {
        set.customDomain = null;
        set.customDomainVerifiedAt = null;
      } else {
        if (!HOSTNAME_RE.test(d)) return NextResponse.json({ error: "Enter a valid domain, e.g. crm.yourfirm.in" }, { status: 400 });
        if (d === base || d.endsWith(`.${base}`)) return NextResponse.json({ error: `Use the subdomain field for ${base} — the custom domain must be your own.` }, { status: 400 });
        // Premium-only. Vanity subdomains stay open to every plan; a fully custom
        // domain requires a premium tier or an explicit `customDomain` feature flag.
        const license = await loadTenantLicense(session.tenantId, session.roles);
        const canCustomDomain =
          !!license.featureFlags?.customDomain ||
          ["professional", "premium", "enterprise", "custom"].includes(license.packageKey ?? "") ||
          license.maxUsers >= 1e9;
        if (!canCustomDomain) {
          return NextResponse.json(
            { error: "Custom domains are a premium feature. Upgrade your plan to use your own domain — a vanity subdomain is available on your current plan." },
            { status: 402 }
          );
        }
        set.customDomain = d;
        // Stamp verified immediately if DNS already points to us; else leave null
        // (Caddy will still serve it once DNS propagates, and they can re-verify).
        set.customDomainVerifiedAt = (await pointsToUs(d)) ? new Date() : null;
      }
    }

    try {
      const updated = await withTenant(session.tenantId, async (tx) => {
        const before = (await tx.select({ subdomain: tenants.subdomain, customDomain: tenants.customDomain }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
        await tx.update(tenants).set(set as any).where(eq(tenants.id, session.tenantId));
        await recordAudit(tx, {
          tenantId: session.tenantId, actorUserId: session.userId, action: "tenant.domain.update",
          entityType: "tenant", entityId: session.tenantId,
          before, after: { subdomain: set.subdomain, customDomain: set.customDomain }, ...meta,
        });
        return (await tx.select({ subdomain: tenants.subdomain, customDomain: tenants.customDomain, customDomainVerifiedAt: tenants.customDomainVerifiedAt }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      });
      return NextResponse.json({
        ok: true,
        subdomain: updated?.subdomain ?? null,
        subdomainHost: updated?.subdomain ? `${updated.subdomain}.${base}` : null,
        customDomain: updated?.customDomain ?? null,
        customDomainVerified: !!updated?.customDomainVerifiedAt,
        cnameTarget: base,
      });
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      if (code === "23505" || String(err?.message ?? "").includes("tenants_subdomain_uq") || String(err?.message ?? "").includes("tenants_custom_domain_uq")) {
        return NextResponse.json({ error: "That subdomain or domain is already taken." }, { status: 409 });
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
