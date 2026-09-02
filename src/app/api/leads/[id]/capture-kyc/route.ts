import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/leads/[id]/capture-kyc
 *   → { clientType, fields, values }
 *   The full KYC field set for this lead's client type (individual / minor /
 *   nri / huf / company / trust) — ALL fields, including the technical /
 *   regulatory ones, because the MFD / back office is filling them here on the
 *   client's behalf. `values` pre-fills anything already on file.
 *
 * POST /api/leads/[id]/capture-kyc
 *   Body: { values: Record<string,string>, remarks?, advance?: boolean }
 *   Writes the collected details into the CLIENT MASTER (the investor if the
 *   lead is already converted, else stashed on the lead and carried over on
 *   conversion) and — when advance !== false — moves the blueprint to
 *   "documents_received" (system bypass: the MFD is confirming receipt).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { transitionTo } from "@/lib/blueprints/engine";
import { loadEditableLead } from "@/lib/leads/access";
import { leads, investors } from "@/db/schema";
import { getAllFields, applyRequiredOverrides, mapKycFieldsToInvestorUpdate } from "@/lib/onboarding/kyc-fields";
import type { ClientType } from "@/lib/onboarding/doc-checklists";

export const dynamic = "force-dynamic";

function toClientType(leadType?: string | null, investorCategory?: string | null): ClientType {
  const v = String(investorCategory ?? leadType ?? "").toLowerCase();
  if (v === "huf") return "huf";
  if (v === "nri") return "nri";
  if (v === "minor") return "minor";
  if (v === "corporate" || v === "company") return "company";
  if (v === "trust") return "trust";
  return "individual"; // individual / hni / other
}

/** Seed the form with whatever is already on file so the MFD only fills gaps. */
function prefill(
  lead: any,
  inv: any | null
): Record<string, string> {
  const base: Record<string, string> = {
    ...((lead?.kycData as Record<string, string>) ?? {}),
    ...((inv?.kycData as Record<string, string>) ?? {}),
  };
  const seed = (k: string, val: any) => {
    if (val != null && String(val).trim() && !base[k]) base[k] = String(val);
  };
  seed("name_as_per_pan", inv?.nameAsPerPan ?? inv?.name ?? lead?.name);
  seed("pan", inv?.pan ?? lead?.pan);
  seed("email", inv?.email ?? lead?.email);
  seed("mobile", inv?.phone ?? lead?.phone);
  seed("dob", inv?.dob);
  const addr = inv?.address ?? null;
  if (addr) {
    seed("address_line1", addr.line1);
    seed("address_city", addr.city);
    seed("address_state", addr.state);
    seed("address_pincode", addr.pincode);
    seed("address_country", addr.country);
  } else {
    seed("address_city", lead?.city);
    seed("address_pincode", lead?.pincode);
  }
  return base;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    const { id } = await params;
    const out = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);
      let inv: any = null;
      if (lead.convertedInvestorId) {
        inv = (await tx.select().from(investors).where(eq(investors.id, lead.convertedInvestorId)))[0] ?? null;
      }
      const clientType = toClientType((lead as any).leadType, inv?.investorCategory);
      // Apply the firm's mandatory-field overrides (admin-set in Settings →
      // Onboarding fields). Absent keys keep the catalog default.
      const ovRow = (
        await tx.execute(
          sql`SELECT required_overrides FROM onboarding_field_settings WHERE tenant_id = ${session.tenantId}::uuid LIMIT 1`
        )
      ).rows[0] as { required_overrides?: Record<string, boolean> } | undefined;
      return {
        clientType,
        fields: applyRequiredOverrides(getAllFields(clientType), ovRow?.required_overrides),
        values: prefill(lead, inv),
        // The client's saved bank accounts — used to pick the mandate bank.
        bankAccounts: (inv?.bankAccounts as any[]) ?? [],
      };
    });
    return NextResponse.json(out);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const Body = z.object({
  values: z.record(z.string(), z.string()).default({}),
  remarks: z.string().max(2000).optional(),
  advance: z.boolean().optional(), // default true
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { remarks } = parsed.data;
    const advance = parsed.data.advance !== false;
    // Drop empty values so we never overwrite a stored value with a blank.
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data.values)) {
      const t = String(v ?? "").trim();
      if (t) values[k] = t;
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const res = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);
      const investorId = lead.convertedInvestorId as string | null;

      // PAN dedup guard. A partial unique index (investors_tenant_pan_unique on
      // tenant_id, pan WHERE dedup_pan) means setting a PAN that another client
      // already holds would 500 the whole save. Detect that up-front, drop just
      // the PAN, and warn — so the rest of the details still save + advance.
      let warning: string | null = null;
      const wantPan = (values["pan"] ?? "").toUpperCase();
      if (investorId && wantPan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(wantPan)) {
        const [me] = await tx
          .select({ dedupPan: investors.dedupPan, pan: investors.pan })
          .from(investors)
          .where(eq(investors.id, investorId))
          .limit(1);
        // Only an issue when this row participates in the dedup index and has no
        // PAN yet (which is exactly when the mapper would set it).
        if (me?.dedupPan && !me.pan) {
          const clash = await tx
            .select({ id: investors.id })
            .from(investors)
            .where(
              and(
                eq(investors.tenantId, session.tenantId),
                eq(investors.pan, wantPan),
                eq(investors.dedupPan, true),
                ne(investors.id, investorId),
              ),
            )
            .limit(1);
          if (clash.length > 0) {
            delete values["pan"];
            warning = `PAN ${wantPan} already belongs to another client, so it wasn't applied to this record. If this is the same person, merge the duplicate; otherwise correct the PAN.`;
          }
        }
      }

      // 1. Write the details into the client master.
      if (Object.keys(values).length > 0) {
        if (investorId) {
          const [inv] = await tx
            .select({
              pan: investors.pan,
              email: investors.email,
              phone: investors.phone,
              whatsappPhone: investors.whatsappPhone,
              address: investors.address,
              bankAccounts: investors.bankAccounts,
              nominees: investors.nominees,
              kycData: investors.kycData,
            })
            .from(investors)
            .where(eq(investors.id, investorId));
          const update = mapKycFieldsToInvestorUpdate(values, inv ?? undefined);
          await tx
            .update(investors)
            .set({
              ...update,
              kycData: { ...((inv?.kycData as any) ?? {}), ...values },
              updatedAt: new Date(),
            } as any)
            .where(eq(investors.id, investorId));
        } else {
          // Not yet converted — stash on the lead; carried onto the investor at
          // conversion (see /api/leads/[id]/convert). Also fill the directly
          // mappable lead columns so the lead record stays useful.
          const existing = (lead as any).kycData as Record<string, string> | null;
          const leadSet: Record<string, any> = {
            kycData: { ...(existing ?? {}), ...values },
            updatedAt: new Date(),
          };
          const pan = (values["pan"] ?? "").toUpperCase();
          if (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) && !lead.pan) leadSet.pan = pan;
          if (values["address_city"] && !lead.city) leadSet.city = values["address_city"];
          if (values["address_pincode"] && !lead.pincode) leadSet.pincode = values["address_pincode"];
          await tx.update(leads).set(leadSet as any).where(eq(leads.id, id));
        }
      }

      // 2. Advance the blueprint to Documents Received (MFD is confirming).
      if (advance) {
        const t = await transitionTo(tx, session.tenantId, id, "documents_received", {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          remarks: remarks ?? "Client details captured by the team — documents received.",
          systemBypass: true,
          ...clientMeta,
        });
        // Keep the lead's own stage column in sync (mirrors the public submit).
        await tx
          .update(leads)
          .set({ stage: "documents_received" as any, stageChangedAt: new Date(), updatedAt: new Date() } as any)
          .where(eq(leads.id, id));
        return { ok: true, advanced: t.ok !== false, savedFields: Object.keys(values).length, warning };
      }
      return { ok: true, advanced: false, savedFields: Object.keys(values).length, warning };
    });

    return NextResponse.json(res);
  } catch (err: any) {
    return handleApiError(err);
  }
}
