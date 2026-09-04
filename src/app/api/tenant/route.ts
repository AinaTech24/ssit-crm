import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/tenant
 * Body: partial tenant fields (owner-only).
 *
 * Allows the MFD owner to update their organisation profile — branding,
 * contact info, address, business profile. ARN/EUIN/GST/plan stay locked
 * to Equitywala (must be edited from the super-admin side).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense, loadTenantLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

const LocalOrAbsoluteUrl = z.string().regex(/^\//).or(z.string().url());

const Body = z.object({
  displayName: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  // Accept a bare domain ("www.firm.in") by normalising to https:// before
  // validating — owners routinely omit the scheme, and a hard url() reject was
  // surfacing as an opaque "invalid body" on save.
  website: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const t = v.trim();
      if (t === "") return "";
      const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      // A scheme-only value like "https://" (no host) — or anything unparseable —
      // is treated as blank rather than 400-ing the whole firm-profile save.
      try {
        return new URL(withScheme).hostname ? withScheme : "";
      } catch {
        return "";
      }
    }, z.string().url().optional().or(z.literal(""))),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  hoverColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  // Deeper theming (0164) — "" clears to default.
  fontFamily: z.enum(["inter", "system", "serif", "rounded", "mono"]).optional().nullable().or(z.literal("")),
  uiDensity: z.enum(["comfortable", "compact"]).optional().nullable().or(z.literal("")),
  logoUrl: LocalOrAbsoluteUrl.optional().or(z.literal("")),
  // Additional brand-logo variants (migration 0083) — each maps to a product
  // context (square icon, monogram, favicon). All optional; empty string clears.
  logoIconUrl: LocalOrAbsoluteUrl.optional().or(z.literal("")),
  logoMarkUrl: LocalOrAbsoluteUrl.optional().or(z.literal("")),
  faviconUrl: LocalOrAbsoluteUrl.optional().or(z.literal("")),
  aumRange: z.string().optional(),
  sipBookRange: z.string().optional(),
  // "Dormant" = no transaction within this many days (30–1095). One firm-level
  // knob every surface reads (Investors KPIs, churn report, the copilot).
  dormancyWindowDays: z.number().int().min(30).max(1095).optional(),
  teamSize: z.string().optional(),
  currentSoftwareUsed: z.string().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  // Network FP "Firm Details" expansion (migration 0023)
  // "" (the unselected "—" option) → null, so leaving it blank doesn't 400 the save.
  legalStructure: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .enum([
        "sole_proprietorship",
        "partnership",
        "llp",
        "private_limited",
        "public_limited",
        "huf",
        "one_person_company",
        "other",
      ])
      .nullable()
      .optional(),
  ),
  incorporationDate: z.string().nullable().optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/i, "PAN format: ABCDE1234F")
    .nullable()
    .optional()
    .or(z.literal("")),
  tan: z
    .string()
    .regex(/^[A-Z]{4}\d{5}[A-Z]$/i, "TAN format: ABCD12345E")
    .nullable()
    .optional()
    .or(z.literal("")),
  gstNumber: z.string().max(20).nullable().optional().or(z.literal("")),
  nationalDistributorCode: z.string().max(40).nullable().optional(),
  primaryDin: z
    .string()
    .regex(/^\d{8}$/, "DIN format: 8 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  auditorName: z.string().max(200).nullable().optional(),
  auditorFrn: z.string().max(40).nullable().optional(),
  bankAccount: z
    .object({
      bankName: z.string().optional(),
      accountHolder: z.string().optional(),
      accountNumber: z.string().optional(),
      ifsc: z.string().optional(),
      branch: z.string().optional(),
      accountType: z.enum(["current", "savings", "od", "cc"]).optional(),
    })
    .nullable()
    .optional(),
  authorizedSignatory: z
    .object({
      name: z.string().optional(),
      designation: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      panNumber: z.string().optional(),
      din: z.string().optional(),
    })
    .nullable()
    .optional(),
  dataProtectionOfficer: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    // Org-profile edits are owner-only. settings.users is owner-only in
    // the matrix; we use that as the umbrella tenant-admin capability.
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      const r = await tx
        .update(tenants)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(eq(tenants.id, session.tenantId))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "tenant.profile_update",
        entityType: "tenant",
        entityId: session.tenantId,
        before: before
          ? {
              displayName: before.displayName,
              email: before.email,
              phone: before.phone,
              logoUrl: before.logoUrl,
              primaryColor: before.primaryColor,
              aumRange: before.aumRange,
            }
          : null,
        after: parse.data,
        ...clientMeta,
      });

      return r[0];
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Org-profile admins (settings.users) get the full row; everyone else gets
    // only the branding/identity fields the UI + template editors need. The
    // sensitive firm financials — bank account, authorised-signatory PAN/DIN,
    // GST/TAN/auditor — never leave the admin scope.
    const isAdmin = can(session.roles, "settings.users", session.permissions);
    const result = await withTenant(session.tenantId, async (tx) => {
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0];
      const license = await loadTenantLicense(session.tenantId, session.roles);
      if (!tenant || isAdmin) return { tenant, license };
      const safe = {
        id: tenant.id,
        displayName: tenant.displayName,
        legalName: tenant.legalName,
        arn: tenant.arn,
        principalEuin: tenant.principalEuin,
        riaRegistered: tenant.riaRegistered,
        logoUrl: tenant.logoUrl,
        logoIconUrl: tenant.logoIconUrl,
        logoMarkUrl: tenant.logoMarkUrl,
        faviconUrl: tenant.faviconUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        textColor: tenant.textColor,
        hoverColor: tenant.hoverColor,
        website: tenant.website,
      };
      return { tenant: safe, license };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
