/**
 * GET /api/duplicates — JSON feed for the mobile Duplicates screen.
 *
 * Mirrors the web /dashboard/duplicates RSC: detects duplicate CLIENTS (by PAN /
 * Phone / Email / Name) and duplicate FAMILIES (by name), then groups them into
 * clusters and drops any cluster the user has already "ignored". Manager-only
 * (owner / branch_head), same as the web page. The existing POST
 * /api/duplicates/ignore is used to suppress a cluster.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { sql, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { ignoredDuplicates } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RULE_ORDER: Record<string, number> = { PAN: 0, Email: 1, Phone: 2, Name: 3 };

export async function GET() {
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => ["owner", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const payload = await withTenant(session.tenantId, async (tx) => {
      const cli = (
        await tx.execute(sql`
          WITH base AS (
            SELECT i.id, i.name, i.pan, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name
            FROM investors i LEFT JOIN users u ON u.id = i.rm_id
            WHERE i.tenant_id = ${session.tenantId}::uuid AND i.merged_into_id IS NULL
          ),
          pan_g AS (SELECT 'PAN' AS kind, upper(pan) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY upper(pan)) AS grp FROM base WHERE pan IS NOT NULL AND pan <> ''),
          phone_g AS (SELECT 'Phone' AS kind, regexp_replace(phone,'\D','','g') AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY regexp_replace(phone,'\D','','g')) AS grp FROM base WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10),
          email_g AS (SELECT 'Email' AS kind, lower(email) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(email)) AS grp FROM base WHERE email IS NOT NULL AND email <> ''),
          name_g AS (SELECT 'Name' AS kind, lower(trim(name)) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(trim(name))) AS grp FROM base WHERE name IS NOT NULL AND trim(name) <> '')
          SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM pan_g WHERE grp > 1
          UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM phone_g WHERE grp > 1
          UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM email_g WHERE grp > 1
          UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM name_g WHERE grp > 1
        `)
      ).rows as any[];

      const fam = (
        await tx.execute(sql`
          WITH base AS (
            SELECT f.id, COALESCE(f.family_name, f.head_name) AS name,
                   lower(trim(COALESCE(f.family_name, f.head_name))) AS nkey,
                   COUNT(i.id) FILTER (WHERE i.status = 'active')::int AS member_count,
                   COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.status = 'active'), 0)::numeric AS family_aum
            FROM families f LEFT JOIN investors i ON i.family_id = f.id
            WHERE f.tenant_id = ${session.tenantId}::uuid
            GROUP BY f.id
          )
          SELECT nkey AS gkey, id, name, member_count, family_aum FROM base b
          WHERE nkey <> '' AND (SELECT count(*) FROM base b2 WHERE b2.nkey = b.nkey) > 1
        `)
      ).rows as any[];

      const ignored = await tx
        .select({ key1: ignoredDuplicates.key1, key2: ignoredDuplicates.key2, entityType: ignoredDuplicates.entityType })
        .from(ignoredDuplicates)
        .where(eq(ignoredDuplicates.tenantId, session.tenantId));

      return { cli, fam, ignored };
    });

    const isIgnoredPair = (id1: string, id2: string, type: "client" | "family") => {
      const [k1, k2] = id1 < id2 ? [id1, id2] : [id2, id1];
      return payload.ignored.some((ig) => ig.entityType === type && ig.key1 === k1 && ig.key2 === k2);
    };
    const isClusterIgnored = (members: { id: string }[], type: "client" | "family") => {
      if (members.length < 2) return true;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          if (!isIgnoredPair(members[i].id, members[j].id, type)) return false;
      return true;
    };

    // Group client rows by (kind, gkey).
    const cliGroups = new Map<string, { kind: string; gkey: string; members: Map<string, any> }>();
    for (const row of payload.cli) {
      const key = `${row.kind}::${row.gkey}`;
      if (!cliGroups.has(key)) cliGroups.set(key, { kind: row.kind, gkey: row.gkey, members: new Map() });
      cliGroups.get(key)!.members.set(row.id, {
        id: row.id, name: row.name, pan: row.pan, phone: row.phone, email: row.email,
        aum: row.aum != null ? Number(row.aum) : null, rmName: row.rm_name ?? null,
      });
    }
    const clientClusters = [...cliGroups.values()]
      .map((g) => ({ kind: g.kind, gkey: g.gkey, members: [...g.members.values()] }))
      .filter((g) => g.members.length > 1)
      .filter((g) => !isClusterIgnored(g.members, "client"))
      .sort((a, b) => (RULE_ORDER[a.kind] ?? 9) - (RULE_ORDER[b.kind] ?? 9) || b.members.length - a.members.length);

    // Group family rows by name key.
    const famGroups = new Map<string, any[]>();
    for (const row of payload.fam) {
      if (!famGroups.has(row.gkey)) famGroups.set(row.gkey, []);
      famGroups.get(row.gkey)!.push({
        id: row.id, name: row.name, memberCount: row.member_count,
        familyAum: row.family_aum != null ? Number(row.family_aum) : null,
      });
    }
    const familyClusters = [...famGroups.entries()]
      .map(([gkey, members]) => ({ gkey, members }))
      .filter((g) => g.members.length > 1)
      .filter((g) => !isClusterIgnored(g.members, "family"));

    const ruleCounts = clientClusters.reduce(
      (m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m),
      {} as Record<string, number>
    );

    return NextResponse.json({ clientClusters, familyClusters, ruleCounts });
  } catch (err) {
    return handleApiError(err);
  }
}
