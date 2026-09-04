/**
 * Host → tenant resolution for white-label hosting.
 *
 *   <sub>.<APP_BASE_DOMAIN>   → tenants.subdomain = <sub>
 *   <firm's own domain>       → tenants.custom_domain = host
 *   <APP_BASE_DOMAIN> itself  → the shared/marketing host (no specific tenant)
 *
 * Cross-tenant by nature (the TLS gate + branded login run without a session),
 * so reads go through withSystem. NODE runtime only — never import from Edge
 * middleware (it pulls in pg).
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { pickLogo } from "@/lib/branding/logo";
import { buildTenantThemeCss } from "@/lib/branding/theme";

/** The apex the vanity subdomains hang off, e.g. "crm.equitywala.com". */
export function appBaseDomain(): string {
  return (process.env.APP_BASE_DOMAIN ?? "crm.equitywala.com").toLowerCase().replace(/\.$/, "");
}

/** Lowercase, strip port + trailing dot. */
export function normalizeHost(host?: string | null): string {
  return (host ?? "").toLowerCase().trim().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Single-label subdomain of the base ("wecare" for wecare.crm.equitywala.com), or null. */
export function subdomainOf(host: string, base = appBaseDomain()): string | null {
  const h = normalizeHost(host);
  if (h === base || !h.endsWith(`.${base}`)) return null;
  const label = h.slice(0, -(base.length + 1));
  // Only a single left-most label maps to a tenant (reject a.b.crm.equitywala.com).
  return /^[a-z0-9-]+$/.test(label) && !label.includes(".") ? label : null;
}

/** True for the shared apex host (crm.equitywala.com / www / localhost / the EC2 IP). */
export function isBaseHost(host: string, base = appBaseDomain()): boolean {
  const h = normalizeHost(host);
  return h === base || h === `www.${base}` || h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}

export type ResolvedHost = { tenantId: string; via: "subdomain" | "custom_domain" } | null;

/** Resolve a request host to a tenant id (or null for the shared/unknown host). */
export async function resolveTenantByHost(host?: string | null): Promise<ResolvedHost> {
  const h = normalizeHost(host);
  if (!h || isBaseHost(h)) return null;

  const sub = subdomainOf(h);
  const row = await withSystem(async (tx) => {
    if (sub) {
      const r = await tx.execute(sql`SELECT id FROM tenants WHERE lower(subdomain) = ${sub} AND deleted_at IS NULL LIMIT 1`);
      if (r.rows[0]) return { id: (r.rows[0] as any).id as string, via: "subdomain" as const };
    }
    const r2 = await tx.execute(sql`SELECT id FROM tenants WHERE lower(custom_domain) = ${h} AND deleted_at IS NULL LIMIT 1`);
    if (r2.rows[0]) return { id: (r2.rows[0] as any).id as string, via: "custom_domain" as const };
    return null;
  });
  return row ? { tenantId: row.id, via: row.via } : null;
}

/** Is this a host we should terminate TLS for? (base apex, a live subdomain, or a registered custom domain.) */
export async function isServableHost(host?: string | null): Promise<boolean> {
  const h = normalizeHost(host);
  if (!h) return false;
  if (isBaseHost(h)) return true;
  return (await resolveTenantByHost(h)) !== null;
}

/** The canonical host a tenant should be reached on (custom domain > subdomain > shared). */
export function canonicalHostForTenant(t: {
  subdomain?: string | null;
  customDomain?: string | null;
  customDomainVerifiedAt?: Date | string | null;
}): string {
  if (t.customDomain && t.customDomainVerifiedAt) return t.customDomain.toLowerCase();
  if (t.subdomain) return `${t.subdomain.toLowerCase()}.${appBaseDomain()}`;
  return appBaseDomain();
}

/** Branding to show on a firm's white-label login page (resolved by host). */
export type LoginBranding = { name: string; logoUrl: string | null; themeCss: string } | null;

export async function resolveLoginBrandingByHost(host?: string | null): Promise<LoginBranding> {
  const resolved = await resolveTenantByHost(host);
  if (!resolved) return null;
  const t = await withSystem(async (tx) =>
    (await tx.execute(sql`
      SELECT display_name, logo_url, logo_icon_url, logo_mark_url, favicon_url,
             primary_color, secondary_color, text_color, hover_color, font_family, ui_density
      FROM tenants WHERE id = ${resolved.tenantId}::uuid LIMIT 1
    `)).rows[0] as any
  );
  if (!t) return null;
  const logoUrl = pickLogo(
    { logoUrl: t.logo_url, logoIconUrl: t.logo_icon_url, logoMarkUrl: t.logo_mark_url, faviconUrl: t.favicon_url },
    "full"
  );
  const themeCss = buildTenantThemeCss(
    t.primary_color, t.secondary_color, t.text_color, t.hover_color, t.font_family, t.ui_density
  );
  return { name: t.display_name ?? "", logoUrl, themeCss };
}

/** Subdomains that can never be claimed (product/infra names). */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "super-admin", "mail", "smtp", "imap", "ftp",
  "crm", "ssit", "status", "cdn", "assets", "static", "help", "support", "docs",
  "blog", "dashboard", "login", "signup", "auth", "webhooks", "public", "demo",
]);
