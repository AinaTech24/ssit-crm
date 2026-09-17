import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/search?q=…
 *
 * Cross-module fuzzy search over investors (name/PAN/phone/email),
 * folios (folio_number), leads, SIPs (scheme name), service requests
 * (ticket_no/subject), complaints, documents. Returns up to 5 per group.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ groups: [] });

    const like = `%${q}%`;
    const likeUpper = `%${q.toUpperCase()}%`;

    const results = await withTenant(session.tenantId, async (tx) => {
      // Same data wall as the Clients/Leads list pages — this search bar is
      // available to every role, including plain RM/sub_broker, and was
      // matching name/PAN/phone/email across the WHOLE firm's clients with no
      // rm_id/service_rm_id/branch filter at all. Folios/SIPs/service requests
      // join investors, so they leaked the same way by proxy. A role with no
      // client/lead view capability at all gets FALSE (empty results for that
      // section) rather than a 500 — this bar mixes roles that have neither.
      const investorScope = await investorScopeSql(tx, session).catch(() => sql`FALSE`);
      const investorScopeI = await investorScopeSql(tx, session, "i").catch(() => sql`FALSE`);
      const leadScope = await leadScopeSql(tx, session, "leads").catch(() => sql`FALSE`);

      const [investors, leads, folios, sips, serviceRequests, documents] = await Promise.all([
        tx.execute(sql`
          SELECT id, name, pan, phone, email, segment_tag
          FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND (name ILIKE ${like} OR pan ILIKE ${likeUpper}
             OR phone ILIKE ${like} OR email ILIKE ${like})
            AND ${investorScope}
          LIMIT 5
        `),
        tx.execute(sql`
          SELECT id, name, phone, email, stage, source
          FROM leads
          WHERE tenant_id = ${session.tenantId}::uuid AND (name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like})
            AND converted_investor_id IS NULL
            AND ${leadScope}
          LIMIT 5
        `),
        tx.execute(sql`
          SELECT f.id, f.folio_number, f.amc_name, f.aum, i.name AS investor_name, i.id AS investor_id
          FROM folios f LEFT JOIN investors i ON i.id = f.investor_id
          WHERE f.tenant_id = ${session.tenantId}::uuid AND f.folio_number ILIKE ${like}
            AND ${investorScopeI}
          LIMIT 5
        `),
        tx.execute(sql`
          SELECT s.id, s.scheme_name, s.amount, s.status, i.name AS investor_name, i.id AS investor_id
          FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
          WHERE s.tenant_id = ${session.tenantId}::uuid AND (s.scheme_name ILIKE ${like} OR s.scheme_code ILIKE ${like})
            AND ${investorScopeI}
          LIMIT 5
        `),
        tx.execute(sql`
          SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, i.name AS investor_name
          FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
          WHERE sr.tenant_id = ${session.tenantId}::uuid AND (sr.ticket_no ILIKE ${like} OR sr.subject ILIKE ${like})
            AND ${investorScopeI}
          LIMIT 5
        `),
        tx.execute(sql`
          SELECT id, name, category, created_at
          FROM compliance_documents
          WHERE tenant_id = ${session.tenantId}::uuid AND name ILIKE ${like}
          LIMIT 5
        `),
      ]);

      return {
        investors: investors.rows,
        leads: leads.rows,
        folios: folios.rows,
        sips: sips.rows,
        serviceRequests: serviceRequests.rows,
        documents: documents.rows,
      };
    });

    return NextResponse.json({ q, ...results });
  } catch (err: any) {
    return handleApiError(err);
  }
}
