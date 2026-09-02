import { sql } from "drizzle-orm";
import { BookOpen } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { MfSchemeSearch } from "./MfSchemeSearch";

export const dynamic = "force-dynamic";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function MfSchemeCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const q = ((await searchParams).q ?? "").trim().replace(/[%_]/g, " ");

  const { stats, rows } = await withTenant(session.tenantId, async (tx) => {
    const statRes = await tx.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM scheme_nav) AS total,
             (SELECT COUNT(*)::int FROM mf_schemes WHERE fund_house IS NOT NULL) AS enriched,
             (SELECT MAX(synced_at) FROM mf_schemes) AS last_sync
    `);
    const stats = (statRes.rows as any[])[0] ?? { total: 0, enriched: 0, last_sync: null };

    let rows: any[] = [];
    if (q.length >= 2) {
      const pat = `%${q}%`;
      const r = await tx.execute(sql`
        SELECT sn.scheme_code AS code, sn.scheme_name AS name,
               COALESCE(m.fund_house, sn.amc_name) AS amc,
               m.scheme_category AS category,
               COALESCE(m.nav, sn.nav)::numeric AS nav,
               COALESCE(m.nav_date, sn.nav_date) AS nav_date
        FROM scheme_nav sn
        LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
        WHERE sn.scheme_name ILIKE ${pat} OR sn.amc_name ILIKE ${pat}
        ORDER BY length(sn.scheme_name) ASC, sn.scheme_name ASC
        LIMIT 100
      `);
      rows = r.rows as any[];
    }
    return { stats, rows };
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="size-5 text-brand-cyan" /> MF Scheme Catalog
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live mutual-fund scheme, AMC &amp; NAV data — shared across the platform, refreshed daily from{" "}
          <span className="font-medium text-foreground">mfapi.in</span>. Used wherever a scheme or AMC is picked.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="chip bg-brand-cyan-light text-brand-cyan-deep">{Number(stats.total).toLocaleString("en-IN")} schemes</span>
        <span className="chip bg-secondary">{Number(stats.enriched).toLocaleString("en-IN")} with AMC / NAV detail</span>
        <span className="text-muted-foreground">Last sync: {stats.last_sync ? fmtDate(stats.last_sync) : "pending first run"}</span>
      </div>

      <MfSchemeSearch initialQuery={q} />

      {q.length < 2 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          Type at least 2 characters to search the catalog by scheme name or AMC.
        </div>
      ) : rows.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          No schemes match “{q}”.{" "}
          {Number(stats.total) === 0 && "The catalog populates on the first daily sync."}
        </div>
      ) : (
        <div className="card-surface table-scroll">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Scheme</th>
                <th className="text-left py-2 font-medium">AMC</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-right py-2 font-medium">NAV</th>
                <th className="text-left py-2 font-medium pr-4">As of</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b last:border-0 hover:bg-brand-cyan-light/25 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="py-2.5 text-xs text-muted-foreground">{r.amc ?? "—"}</td>
                  <td className="py-2.5 text-xs text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.nav != null ? `₹${Number(r.nav).toFixed(2)}` : "—"}</td>
                  <td className="py-2.5 pr-4 text-xs tabular-nums text-muted-foreground">{fmtDate(r.nav_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
