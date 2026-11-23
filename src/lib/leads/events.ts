/**
 * The firm's list of lead events (seminars, expos, society camps ...).
 *
 * One list, used everywhere: the New-lead form, Edit lead, and the bulk "Update a field".
 * It is the firm-managed `master_values` rows (master_type 'lead_event'), PLUS any event
 * name already sitting on a lead that was never added to that list (typed in an import,
 * an older form, or a spelling nobody added) - so every event you can see in the By-event
 * strip can also be picked. An event someone removed from the list stays removed: its row
 * is kept inactive, and an inactive key is never brought back by a lead that still carries
 * the name.
 */

import { v4 as uuid } from "uuid";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { masterValues } from "@/db/schema";

export const LEAD_EVENT_MASTER = "lead_event" as const;

/** "Mumbai Investor Meet 2026" → "mumbai_investor_meet_2026" */
export function eventKeyFor(label: string): string {
  return (
    label
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `event_${Date.now().toString(36)}`
  );
}

export type LeadEventRow = { key: string; label: string };

/** Active events from the master list, plus event names found on leads that the list does not know. */
export async function listLeadEvents(tx: Tx, tenantId: string): Promise<LeadEventRow[]> {
  const master = await tx
    .select({
      key: masterValues.key,
      label: masterValues.label,
      isActive: masterValues.isActive,
      sortOrder: masterValues.sortOrder,
    })
    .from(masterValues)
    .where(and(eq(masterValues.tenantId, tenantId), eq(masterValues.masterType, LEAD_EVENT_MASTER)))
    .orderBy(asc(masterValues.sortOrder), asc(masterValues.label));

  const known = new Set(master.map((m) => m.key));
  const out: LeadEventRow[] = master.filter((m) => m.isActive).map((m) => ({ key: m.key, label: m.label }));

  const used = await tx.execute(sql`
    SELECT min(btrim(source_campaign)) AS label
      FROM leads
     WHERE tenant_id = ${tenantId}::uuid
       AND deleted_at IS NULL
       AND source_campaign IS NOT NULL AND btrim(source_campaign) <> ''
     GROUP BY lower(btrim(source_campaign))
  `);
  for (const r of used.rows as Array<{ label: string | null }>) {
    const label = (r.label ?? "").trim();
    if (label.length < 2 || label.length > 120) continue;
    const key = eventKeyFor(label);
    if (known.has(key)) continue; // already listed, or deliberately removed
    known.add(key);
    out.push({ key, label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Make sure `label` is in the list (adds it, or switches a removed one back on) and
 * return the stored spelling. Adding the same event twice is a no-op.
 */
export async function ensureLeadEvent(tx: Tx, tenantId: string, label: string): Promise<LeadEventRow> {
  const key = eventKeyFor(label);
  const [existing] = await tx
    .select({ key: masterValues.key, label: masterValues.label })
    .from(masterValues)
    .where(and(eq(masterValues.tenantId, tenantId), eq(masterValues.masterType, LEAD_EVENT_MASTER), eq(masterValues.key, key)))
    .limit(1);
  if (existing) {
    await tx
      .update(masterValues)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(masterValues.tenantId, tenantId), eq(masterValues.masterType, LEAD_EVENT_MASTER), eq(masterValues.key, key)));
    return existing;
  }
  await tx.insert(masterValues).values({
    id: uuid(),
    tenantId,
    masterType: LEAD_EVENT_MASTER,
    key,
    label,
    sortOrder: 0,
    isActive: true,
    isSystemDefault: false,
  });
  return { key, label };
}

/** Take an event out of the list. An event that only lives on leads gets an inactive row so it stays gone. */
export async function removeLeadEvent(tx: Tx, tenantId: string, key: string, label: string | null): Promise<boolean> {
  const updated = await tx
    .update(masterValues)
    .set({ isActive: false })
    .where(and(eq(masterValues.tenantId, tenantId), eq(masterValues.masterType, LEAD_EVENT_MASTER), eq(masterValues.key, key)))
    .returning({ key: masterValues.key });
  if (updated.length > 0) return true;
  const text = (label ?? "").trim();
  if (!text || eventKeyFor(text) !== key) return false;
  await tx.insert(masterValues).values({
    id: uuid(),
    tenantId,
    masterType: LEAD_EVENT_MASTER,
    key,
    label: text,
    sortOrder: 0,
    isActive: false,
    isSystemDefault: false,
  });
  return true;
}
