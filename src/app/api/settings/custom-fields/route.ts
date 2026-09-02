/**
 * GET  /api/settings/custom-fields?entity=lead|investor
 *   List a firm's custom-field definitions for an entity (any signed-in user —
 *   needed to render the fields).
 * POST /api/settings/custom-fields
 *   Create a definition (firm-admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { customFieldDefs } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const ENTITIES = ["lead", "investor"] as const;
const TYPES = ["text", "textarea", "number", "currency", "date", "select", "radio", "multiselect", "checkbox", "email", "phone", "url"] as const;
// Types whose `options` array holds the user-defined list of choices.
const CHOICE_TYPES = ["select", "radio", "multiselect"];

const CreateBody = z.object({
  entity: z.enum(ENTITIES),
  label: z.string().min(1).max(80),
  type: z.enum(TYPES),
  // Choice list (select/radio/multiselect) or the single currency code (currency).
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
});

/** Stable snake_case key from a label, prefixed to avoid clashing with real columns. */
function keyFromLabel(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  return `cf_${base}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const entity = req.nextUrl.searchParams.get("entity") ?? "";
    if (!ENTITIES.includes(entity as any)) return NextResponse.json({ error: "invalid entity" }, { status: 400 });
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx.select().from(customFieldDefs)
        .where(and(eq(customFieldDefs.tenantId, session.tenantId), eq(customFieldDefs.entity, entity as any)))
        .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.createdAt))
    );
    return NextResponse.json({ fields: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions); // firm-admin defines fields
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const d = parse.data;
    if (CHOICE_TYPES.includes(d.type) && !(d.options && d.options.length)) {
      return NextResponse.json({ error: "This field type needs at least one option." }, { status: 400 });
    }
    if (d.type === "currency" && !(d.options && d.options.length)) {
      // Default to INR if the client didn't send a currency code.
      d.options = ["INR"];
    }

    try {
      const row = await withTenant(session.tenantId, async (tx) => {
        // Next sort order + unique key (append -2, -3… on collision).
        const existing = await tx.select({ key: customFieldDefs.key }).from(customFieldDefs)
          .where(and(eq(customFieldDefs.tenantId, session.tenantId), eq(customFieldDefs.entity, d.entity)));
        const taken = new Set(existing.map((r) => r.key));
        let key = keyFromLabel(d.label);
        let n = 2;
        while (taken.has(key)) key = `${keyFromLabel(d.label)}_${n++}`;
        const [r] = await tx.insert(customFieldDefs).values({
          tenantId: session.tenantId, entity: d.entity, key, label: d.label, type: d.type,
          // Persist options for choice types AND the currency code for currency.
          options: (CHOICE_TYPES.includes(d.type) || d.type === "currency") ? d.options : null,
          required: !!d.required,
          sortOrder: existing.length, createdBy: session.userId,
        } as any).returning();
        return r;
      });
      return NextResponse.json({ field: row }, { status: 201 });
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === "23505") return NextResponse.json({ error: "A field with that name already exists." }, { status: 409 });
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}
