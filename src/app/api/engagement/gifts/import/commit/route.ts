import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/engagement/gifts/import/commit  { mapping, rows }
 *
 * Logs a batch of gifts — a festival list, a birthday month, a hamper order
 * for forty clients.
 *
 * Each row has to resolve to a REAL client the uploader may see: matched on PAN
 * first (unambiguous) then on exact name, and a name matching two clients is
 * reported rather than guessed at. Nobody wants to discover later that a gift
 * went onto the wrong Sharma.
 *
 * rm_id is taken from the matched client, never from the sheet, so the per-RM
 * tallies on the engagement board stay true to who actually owns the
 * relationship.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investorScopeSql } from "@/lib/investors/access";
import { GIFT_CATEGORIES, giftLabel, isValidGrade } from "@/lib/gifts/catalogue";
import { nameKey, parseSheetDate } from "@/lib/gifts/import";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.any())).max(5000),
});

const OCCASIONS = new Set(["birthday", "anniversary", "festival", "other"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["investor.edit.all", "investor.edit.assigned", "gifting.manage"],
      session.permissions
    );
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { mapping, rows } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) if (field) reverse[field] = header;
    const pick = (row: Record<string, any>, field: string): string => {
      const header = reverse[field];
      if (!header) return "";
      const v = row[header];
      return v == null ? "" : String(v).trim();
    };
    const pickRaw = (row: Record<string, any>, field: string): unknown =>
      reverse[field] ? row[reverse[field]] : null;

    const result = await withTenant(session.tenantId, async (tx) => {
      // Only clients this uploader may see — the importer must not become a way
      // to write against someone else's book.
      const scope = await investorScopeSql(tx, session, "investors");
      const clientsRes = await tx.execute(sql`
        SELECT investors.id, investors.name, investors.pan, investors.rm_id
          FROM investors
         WHERE investors.deleted_at IS NULL
           AND ${scope}
      `);
      const byPan = new Map<string, { id: string; rmId: string | null }>();
      const byName = new Map<string, { id: string; rmId: string | null } | "ambiguous">();
      for (const c of clientsRes.rows as { id: string; name: string | null; pan: string | null; rm_id: string | null }[]) {
        const entry = { id: String(c.id), rmId: c.rm_id ? String(c.rm_id) : null };
        if (c.pan) byPan.set(c.pan.trim().toUpperCase(), entry);
        if (c.name) {
          const key = nameKey(c.name);
          byName.set(key, byName.has(key) ? "ambiguous" : entry);
        }
      }

      let inserted = 0;
      // Which months the gifts landed in - the board shows one month at a time.
      const months = new Map<string, number>();
      const errors: { rowIndex: number; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const who = pick(row, "client");
        if (!who) {
          errors.push({ rowIndex: i, error: "client is blank" });
          continue;
        }
        const match = byPan.get(who.toUpperCase()) ?? byName.get(nameKey(who));
        if (!match) {
          errors.push({ rowIndex: i, error: `no client of yours matches "${who}"` });
          continue;
        }
        if (match === "ambiguous") {
          errors.push({ rowIndex: i, error: `"${who}" matches more than one client — use the PAN instead` });
          continue;
        }

        const givenOn = parseSheetDate(pickRaw(row, "givenOn"));
        if (!givenOn) {
          errors.push({ rowIndex: i, error: "given-on date is missing or not a date (write it day first, e.g. 27-11-2026)" });
          continue;
        }
        const deliveredOn = parseSheetDate(pickRaw(row, "deliveredOn"));

        // A category the list does not have is kept as "Other" with that text.
        const typed = pick(row, "category");
        const categoryRaw = typed.toLowerCase();
        const known = (GIFT_CATEGORIES as readonly string[]).includes(categoryRaw);
        const category = known ? categoryRaw : typed ? "other" : null;
        const categoryOther = category === "other" ? (known ? pick(row, "title") : typed).slice(0, 60) || null : null;
        const gradeRaw = pick(row, "grade").toUpperCase();
        const grade = category && isValidGrade(category, gradeRaw) ? gradeRaw : null;

        const occasionRaw = pick(row, "occasion").toLowerCase();
        const occasion = OCCASIONS.has(occasionRaw) ? occasionRaw : "other";

        const amountNum = Number(pick(row, "amount").replace(/[^0-9.-]/g, ""));
        const amount = Number.isFinite(amountNum) && amountNum >= 0 ? Math.round(amountNum) : 0;

        // Title is what the log reads as; fall back to the catalogue pair so a
        // sheet with only category+grade still produces a legible row.
        const title = pick(row, "title") || (category ? giftLabel(category, grade, categoryOther) : "Gift");

        try {
          // Its own savepoint: one bad row must not undo the whole upload.
          await tx.transaction(async (sp) => {
            await sp.execute(sql`
              INSERT INTO client_gifts
                (id, tenant_id, investor_id, rm_id, category, category_other, grade, occasion, title,
                 amount, given_on, delivered_on, notes, created_by, created_at, updated_at)
              VALUES (
                ${uuid()}, ${session.tenantId}::uuid, ${match.id}::uuid, ${match.rmId}::uuid,
                ${category}, ${categoryOther}, ${grade}, ${occasion}, ${title},
                ${amount}, ${givenOn}::date, ${deliveredOn}::date,
                ${pick(row, "notes") || null}, ${session.userId}::uuid, now(), now()
              )
            `);
          });
          inserted++;
          const month = givenOn.slice(0, 7);
          months.set(month, (months.get(month) ?? 0) + 1);
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err?.message ?? "insert failed") });
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "client_gift.bulk_import",
        entityType: "client_gift",
        entityId: null,
        meta: { inserted, errored: errors.length, totalRows: rows.length },
        ...clientMeta,
      });

      return { inserted, errors, months: [...months.entries()].sort() };
    });

    const where = result.months
      .map(([m, n]) => `${new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}: ${n}`)
      .join(", ");
    return NextResponse.json({
      inserted: result.inserted,
      skipped: 0,
      errored: result.errors.length,
      // Sheet row numbers: row 1 is the heading.
      errors: result.errors.map((e) => ({ ...e, rowIndex: e.rowIndex + 2 })),
      note: where ? `Added by month - ${where}. Use the month arrows on the engagement calendar to see them.` : "Nothing was added - see the errors below.",
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
