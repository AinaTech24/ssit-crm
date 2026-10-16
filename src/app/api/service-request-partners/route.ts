import { handleApiError } from "@/lib/api/error-handler";
/**
 * The partners a service request can be raised with.
 *
 *   GET    /api/service-request-partners          - the firm's active partners
 *   POST   /api/service-request-partners {label}  - add one (idempotent)
 *   DELETE /api/service-request-partners?key=...  - remove one
 *
 * Stored as master_values rows with master_type = 'service_partner', the same
 * way named lead events are, so the list is firm-managed from the form itself
 * instead of being a code change every time a partner is added.
 *
 * Removal is a soft switch-off: tickets keep the partner NAME as text, so past
 * tickets read the same, and re-adding the name later reactivates the row.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { masterValues } from "@/db/schema";

export const dynamic = "force-dynamic";

const MASTER_TYPE = "service_partner" as const;
const CAPS = ["service_request.create", "service_request.manage"] as const;

function keyFor(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...CAPS], session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({ key: masterValues.key, label: masterValues.label })
        .from(masterValues)
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.isActive, true)
          )
        )
        .orderBy(asc(masterValues.sortOrder), asc(masterValues.label))
    );
    return NextResponse.json({ partners: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...CAPS], session.permissions);
    const parse = z.object({ label: z.string().trim().min(2).max(120) }).safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "a partner name is required" }, { status: 400 });
    const label = parse.data.label;
    const key = keyFor(label);
    if (!key) return NextResponse.json({ error: "a partner name is required" }, { status: 400 });

    const partner = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ key: masterValues.key, label: masterValues.label })
        .from(masterValues)
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.key, key)
          )
        )
        .limit(1);
      if (existing) {
        await tx
          .update(masterValues)
          .set({ isActive: true })
          .where(
            and(
              eq(masterValues.tenantId, session.tenantId),
              eq(masterValues.masterType, MASTER_TYPE),
              eq(masterValues.key, key)
            )
          );
        return existing;
      }
      await tx.insert(masterValues).values({
        id: uuid(),
        tenantId: session.tenantId,
        masterType: MASTER_TYPE,
        key,
        label,
        isActive: true,
        sortOrder: 0,
      } as any);
      return { key, label };
    });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...CAPS], session.permissions);
    const key = new URL(req.url).searchParams.get("key")?.trim();
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    const updated = await withTenant(session.tenantId, async (tx) =>
      tx
        .update(masterValues)
        .set({ isActive: false })
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, MASTER_TYPE),
            eq(masterValues.key, key)
          )
        )
        .returning({ key: masterValues.key })
    );
    if (updated.length === 0) return NextResponse.json({ error: "partner not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
