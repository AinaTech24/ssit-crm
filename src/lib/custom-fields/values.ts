/**
 * Server-side helpers for MFD custom-field values — shared by the values PATCH
 * route, the lead/investor create routes, and the CSV import commits so every
 * write path coerces + sanitizes values against the firm's definitions the same
 * way. Unknown keys are dropped; each value is coerced to its field type.
 */

import { and, eq } from "drizzle-orm";
import { customFieldDefs } from "@/db/schema";
import type { Tx } from "@/db/client";

export type CustomFieldDefRow = { key: string; type: string; options: string[] | null };

/** Coerce a raw input to the field's type; returns undefined to drop it. */
export function coerceCustomField(type: string, raw: any, options?: string[] | null): any {
  // checkbox is the one type where false/empty is a meaningful value.
  if (type === "checkbox") {
    if (typeof raw === "string") return ["true", "yes", "1", "y", "on"].includes(raw.trim().toLowerCase());
    return !!raw;
  }
  if (raw === undefined || raw === null || raw === "") return undefined;
  switch (type) {
    case "number":
    case "currency": {
      const n = Number(String(raw).replace(/[,₹$€£\s]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
    case "select":
    case "radio":
      return options && options.includes(String(raw)) ? String(raw) : undefined;
    case "multiselect": {
      // Accept an array, or a comma-separated string (CSV import).
      const arr = Array.isArray(raw) ? raw : String(raw).split(",");
      const allowed = new Set(options ?? []);
      const clean = arr.map((x) => String(x).trim()).filter((x) => allowed.has(x));
      return clean.length ? clean : undefined;
    }
    default:
      return String(raw).slice(0, 2000);
  }
}

/** Sanitize a raw values bag against the firm's definitions. */
export function sanitizeCustomFields(defs: CustomFieldDefRow[], values: Record<string, any> | null | undefined): Record<string, any> {
  const clean: Record<string, any> = {};
  if (!values) return clean;
  for (const d of defs) {
    const v = coerceCustomField(d.type, values[d.key], d.options as string[] | null);
    if (v !== undefined) clean[d.key] = v;
  }
  return clean;
}

/** Load a firm's custom-field definitions for an entity (inside an open tx). */
export async function loadCustomFieldDefs(tx: Tx, tenantId: string, entity: "lead" | "investor"): Promise<CustomFieldDefRow[]> {
  const rows = await tx
    .select({ key: customFieldDefs.key, type: customFieldDefs.type, options: customFieldDefs.options })
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.tenantId, tenantId), eq(customFieldDefs.entity, entity)));
  return rows as CustomFieldDefRow[];
}
