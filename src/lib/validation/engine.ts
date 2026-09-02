/**
 * Validation engine — evaluate a record against the tenant's configured
 * Validation Rules (Zoho parity). Pure given the loaded rules; returns the
 * violations so the UI can block (severity=block) or warn.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };
export type Violation = { field: string; message: string; severity: "block" | "warn" };

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function check(op: string, raw: any, value: string | null): boolean {
  const s = raw == null ? "" : String(raw).trim();
  switch (op) {
    case "required":
    case "not_empty": return s.length > 0;
    case "min_length": return s.length >= Number(value || 0);
    case "regex": { try { return new RegExp(value || "").test(s); } catch { return true; } }
    case "is_email": return s === "" || EMAIL_RE.test(s);
    case "is_phone": return s === "" || s.replace(/\D/g, "").length >= 10;
    case "is_pan": return s === "" || PAN_RE.test(s.toUpperCase());
    default: return true;
  }
}

export async function validateRecord(
  tx: Tx,
  opts: { tenantId: string; subjectType: "lead" | "investor"; record: Record<string, any> }
): Promise<Violation[]> {
  const rules = (await tx.execute(sql`
    SELECT field, operator, value, applies_when, error_message, severity
    FROM validation_rules WHERE tenant_id = ${opts.tenantId}::uuid AND subject_type = ${opts.subjectType} AND is_active = true
  `)).rows as any[];

  const out: Violation[] = [];
  for (const r of rules) {
    const when = r.applies_when ?? {};
    let applies = true;
    for (const [k, v] of Object.entries(when)) {
      if (!v) continue;
      if (String(opts.record[k] ?? "").toLowerCase() !== String(v).toLowerCase()) { applies = false; break; }
    }
    if (!applies) continue;
    if (!check(r.operator, opts.record[r.field], r.value)) {
      out.push({ field: r.field, message: r.error_message, severity: r.severity === "warn" ? "warn" : "block" });
    }
  }
  return out;
}
