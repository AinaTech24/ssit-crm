import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/import/commit  Body: { mapping, rows }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { scoreFields } from "@/lib/leads/score";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";

export const dynamic = "force-dynamic";

const Body = z.object({
  mapping: z.record(z.string(), z.string()),
  // Bound the payload: the import runs as one transaction, so an unbounded
  // array would hold a write lock + memory for minutes. 10k/upload is well above
  // a normal book migration; larger imports should be split.
  rows: z.array(z.record(z.string(), z.any())).max(10000),
  /**
   * Run the new-lead automation for every imported row — the welcome
   * WhatsApp + email the manual create path already triggers.
   *
   * OFF by default, and deliberately so: an import is how an event attendee
   * list of 500 arrives, and messaging 500 people is not something to do
   * because a checkbox defaulted on. The importer asks; the firm decides.
   */
  sendWelcome: z.boolean().default(false),
});

const VALID_STAGES = new Set(["new", "contacted", "qualified", "proposal_sent", "converted", "lost", "cold"]);
const VALID_SOURCES = new Set([
  "website", "referral", "meta_ads", "google_ads", "linkedin", "youtube",
  "webinar", "event", "walk_in", "manual", "other",
]);
const VALID_AUM = new Set(["under_10l", "10l_50l", "50l_2cr", "hni_2cr_plus"]);
const VALID_LEAD_TYPE = new Set(["individual", "hni", "nri", "corporate", "minor"]);

const numOrNull = (v: string) => { const n = Number(String(v).replace(/[,₹\s]/g, "")); return Number.isFinite(n) && n >= 0 ? n : null; };
/** Split a "a, b; c" cell into a clean string array (for jsonb columns). */
const listOrNull = (v: string): string[] | null => {
  const parts = String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return parts.length ? parts : null;
};
/** Lenient date → ISO yyyy-mm-dd (DD-MM-YYYY, DD/MM/YYYY, Excel serial, ISO). */
function dateOrNull(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4,6}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 0 && serial < 100000) { const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
  }
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let day = +m[1], mon = +m[2], year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) { const d = new Date(Date.UTC(year, mon - 1, day)); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
    return null;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // An RM imports leads into their OWN pipeline — every row below is stamped
    // owner_id = the importer, so "edit all" is the wrong bar. Requiring it
    // blocked every RM, sub-broker, RA-sales, RIA and insurance user from bulk
    // lead upload entirely, which is most of the people who do it.
    requireAny(session.roles, ["lead.create"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const reverse: Record<string, string> = {};
    for (const [src, our] of Object.entries(parse.data.mapping)) if (our) reverse[our] = src;
    if (!reverse.name) return NextResponse.json({ error: "mapping must include name" }, { status: 400 });

    function pick(row: any, h?: string) {
      if (!h) return "";
      const v = row[h];
      return v === null || v === undefined ? "" : String(v).trim();
    }

    let inserted = 0;
    const insertedIds: string[] = [];
    let skipped = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    await withTenant(session.tenantId, async (tx) => {
      // Firm custom-field definitions — any mapped cf_* column is sanitized + stored.
      const cfDefs = await loadCustomFieldDefs(tx, session.tenantId, "lead");

      for (let i = 0; i < parse.data.rows.length; i++) {
        const row = parse.data.rows[i];
        const name = pick(row, reverse.name);
        if (!name) {
          errors.push({ rowIndex: i, error: "missing name" });
          continue;
        }
        const sourceRaw = pick(row, reverse.source).toLowerCase().replace(/\s+/g, "_");
        const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : "manual";
        const stageRaw = pick(row, reverse.stage).toLowerCase().replace(/\s+/g, "_");
        const stage = VALID_STAGES.has(stageRaw) ? stageRaw : "new";

        const emailVal = pick(row, reverse.email) || null;
        const phoneVal = pick(row, reverse.phone) || null;
        const intendedVal = pick(row, reverse.intendedAmount) || null;
        // New-lead-form fields.
        const aumRaw = pick(row, reverse.aumPotential).toLowerCase().replace(/\s+/g, "_");
        const aum = VALID_AUM.has(aumRaw) ? aumRaw : null;
        const ltRaw = pick(row, reverse.leadType).toLowerCase().replace(/\s+/g, "_");
        const leadType = VALID_LEAD_TYPE.has(ltRaw) ? ltRaw : null;
        const interest = listOrNull(pick(row, reverse.interestedIn));
        const occupation = pick(row, reverse.occupation) || null;
        const currentInv = listOrNull(pick(row, reverse.currentInvestments));
        const profile = occupation || currentInv ? { occupation: occupation ?? undefined, currentInvestments: currentInv ?? undefined } : null;
        const tags = listOrNull(pick(row, reverse.tags));
        // Custom fields: read each mapped cf_* column, sanitize against defs.
        const rawCf: Record<string, any> = {};
        for (const d of cfDefs) rawCf[d.key] = pick(row, reverse[d.key]);
        const cleanCf = sanitizeCustomFields(cfDefs, rawCf);
        const cfJson = Object.keys(cleanCf).length ? JSON.stringify(cleanCf) : null;
        // Deterministic initial score from the imported signals.
        const sc = scoreFields({
          source,
          stage,
          intendedAmount: intendedVal,
          email: emailVal,
          phone: phoneVal,
        });

        const leadId = uuid();
        try {
          await tx.execute(sql`
            INSERT INTO leads (
              id, tenant_id, branch_id, name, email, phone, alt_phone, alt_email, pan, city, pincode,
              source, source_campaign, stage, stage_changed_at, score, intended_amount,
              expected_business_amount, aum_potential, lead_type, interest_products, profile,
              referred_by_name, next_follow_up_at, tags,
              lead_score, score_band, scored_at,
              owner_id, notes, custom_fields, created_at, updated_at
            )
            VALUES (
              ${leadId}, ${session.tenantId}, ${session.branchId ?? null},
              ${name},
              ${emailVal},
              ${phoneVal},
              ${pick(row, reverse.altPhone) || null},
              ${pick(row, reverse.altEmail) || null},
              ${pick(row, reverse.pan).toUpperCase() || null},
              ${pick(row, reverse.city) || null},
              ${pick(row, reverse.pincode) || null},
              ${source}, ${pick(row, reverse.campaignName) || null},
              ${stage}, now(),
              ${pick(row, reverse.score) || "0"},
              ${intendedVal},
              ${numOrNull(pick(row, reverse.expectedBusinessAmount))},
              ${aum}, ${leadType},
              ${interest ? JSON.stringify(interest) : "[]"}::jsonb,
              ${profile ? JSON.stringify(profile) : "{}"}::jsonb,
              ${pick(row, reverse.referredByName) || null},
              ${dateOrNull(pick(row, reverse.nextFollowUpAt))},
              ${tags ? JSON.stringify(tags) : "[]"}::jsonb,
              ${sc.leadScore}, ${sc.scoreBand}, now(),
              ${session.userId},
              ${pick(row, reverse.notes) || null},
              ${cfJson}::jsonb,
              now(), now()
            )
          `);
          inserted++;
          insertedIds.push(leadId);
        } catch (err: any) {
          errors.push({ rowIndex: i, error: String(err.message ?? "insert failed") });
        }
      }

      // Run the new-lead automation for the imported rows, when asked. This is
      // what makes an EVENT lead behave like one typed in by hand: the same
      // lead.created event, so the installed welcome recipe sends its WhatsApp
      // and email. Without it an imported attendee list landed silently, which
      // is why event leads never got a message.
      if (parse.data.sendWelcome && insertedIds.length) {
        for (const leadId of insertedIds) {
          await tx.execute(sql`
            INSERT INTO events_outbox (tenant_id, kind, entity_type, entity_id, after, meta)
            VALUES (
              ${session.tenantId}::uuid, 'lead.created', 'lead', ${leadId}::uuid,
              ${JSON.stringify({ via: "import" })}::jsonb,
              ${JSON.stringify({ userId: session.userId })}::jsonb
            )
          `);
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.bulk_import",
        entityType: "lead",
        entityId: null,
        meta: { inserted, skipped, errored: errors.length, totalRows: parse.data.rows.length, sendWelcome: parse.data.sendWelcome },
        ...clientMeta,
      });
    });

    return NextResponse.json({ inserted, skipped, errored: errors.length, errors: errors.slice(0, 50) });
  } catch (err: any) {
    return handleApiError(err);
  }
}
