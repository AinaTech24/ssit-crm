import Link from "next/link";
import { sql } from "drizzle-orm";
import { Flame, ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { leadScopeSql, requireLeadView } from "@/lib/leads/access";

type Rec = Record<string, any>;
export const dynamic = "force-dynamic";

const BANDS = ["hot", "warm", "cold"] as const;
const BAND_TONE: Record<string, string> = {
  hot: "bg-rose-50 text-rose-700",
  warm: "bg-amber-50 text-amber-700",
  cold: "bg-sky-50 text-sky-700",
};

/**
 * Hot leads — how the pipeline splits into hot / warm / cold, by event and by
 * branch, with filters. Counted under the same data wall as the Leads list, so
 * a branch head sees their own branch and an RM sees their own leads.
 */
export default async function HotLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireLeadView(session);
  const sp = await searchParams;
  const band = BANDS.includes(sp.band as (typeof BANDS)[number]) ? (sp.band as string) : "";
  const event = (sp.event ?? "").trim();
  const unit = (sp.unit ?? "").trim();
  const owner = /^[0-9a-f-]{36}$/i.test(sp.owner ?? "") ? (sp.owner as string) : "";

  const data = await withTenant(session.tenantId, async (tx) => {
    const base = [
      sql`leads.tenant_id = ${session.tenantId}::uuid`,
      sql`leads.deleted_at IS NULL`,
      sql`leads.lost_reason IS DISTINCT FROM '__deleted__'`,
      sql`leads.converted_investor_id IS NULL`,
      sql`leads.stage NOT IN ('lost', 'not_interested', 'converted')`,
      await leadScopeSql(tx, session, "leads"),
    ];
    // Filter-menu options come from the wall alone, so choosing one filter never
    // empties the other menus.
    const baseWhere = sql.join(base, sql` AND `);
    const filt = [...base];
    if (band) filt.push(sql`leads.score_band = ${band}`);
    if (event) filt.push(sql`lower(btrim(leads.source_campaign)) = ${event.toLowerCase()}`);
    if (unit) filt.push(sql`COALESCE(d.name, b.name) = ${unit}`);
    if (owner) filt.push(sql`leads.owner_id = ${owner}::uuid`);
    const where = sql.join(filt, sql` AND `);

    const from = sql`
      FROM leads
      LEFT JOIN users u ON u.id = leads.owner_id
      LEFT JOIN desks d ON d.id = u.desk_id
      LEFT JOIN branches b ON b.id = u.branch_id`;

    const [summary, byEvent, byUnit, list, events, units, owners] = await Promise.all([
      tx.execute(sql`
        SELECT leads.score_band AS band, COUNT(*)::int AS n ${from} WHERE ${where} GROUP BY leads.score_band`),
      tx.execute(sql`
        SELECT COALESCE(NULLIF(btrim(leads.source_campaign), ''), 'No event') AS label,
               COUNT(*) FILTER (WHERE leads.score_band = 'hot')::int AS hot,
               COUNT(*) FILTER (WHERE leads.score_band = 'warm')::int AS warm,
               COUNT(*) FILTER (WHERE leads.score_band = 'cold')::int AS cold,
               COUNT(*)::int AS total
        ${from} WHERE ${where}
        GROUP BY 1 ORDER BY hot DESC, total DESC LIMIT 100`),
      tx.execute(sql`
        SELECT COALESCE(d.name, b.name, 'No branch') AS label,
               COUNT(*) FILTER (WHERE leads.score_band = 'hot')::int AS hot,
               COUNT(*) FILTER (WHERE leads.score_band = 'warm')::int AS warm,
               COUNT(*) FILTER (WHERE leads.score_band = 'cold')::int AS cold,
               COUNT(*)::int AS total
        ${from} WHERE ${where}
        GROUP BY 1 ORDER BY hot DESC, total DESC LIMIT 100`),
      tx.execute(sql`
        SELECT leads.id, leads.name, leads.phone, leads.stage, leads.score_band, leads.lead_score,
               leads.source_campaign, u.name AS owner_name, COALESCE(d.name, b.name) AS unit_name
        ${from} WHERE ${where}
        ORDER BY (leads.score_band = 'hot') DESC, leads.lead_score DESC NULLS LAST
        LIMIT 100`),
      tx.execute(sql`
        SELECT MIN(btrim(leads.source_campaign)) AS name FROM leads
         WHERE ${baseWhere} AND NULLIF(btrim(leads.source_campaign), '') IS NOT NULL
         GROUP BY lower(btrim(leads.source_campaign)) ORDER BY 1`),
      tx.execute(sql`
        SELECT DISTINCT COALESCE(d.name, b.name) AS name ${from}
         WHERE ${baseWhere} AND COALESCE(d.name, b.name) IS NOT NULL ORDER BY 1`),
      tx.execute(sql`
        SELECT DISTINCT u.id, u.name ${from}
         WHERE ${baseWhere} AND u.id IS NOT NULL ORDER BY u.name`),
    ]);
    const counts: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
    for (const r of summary.rows as Rec[]) counts[r.band] = Number(r.n);
    return {
      counts,
      byEvent: byEvent.rows as Rec[],
      byUnit: byUnit.rows as Rec[],
      list: list.rows as Rec[],
      events: events.rows as Rec[],
      units: units.rows as Rec[],
      owners: owners.rows as Rec[],
    };
  });

  const total = data.counts.hot + data.counts.warm + data.counts.cold;

  const Table = ({ title, rows }: { title: string; rows: any[] }) => (
    <div className="card-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b font-medium text-sm">{title}</div>
      <div className="table-scroll">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{title.includes("Event") ? "Event" : "Branch"}</th>
              <th className="px-3 py-2 text-right">Hot</th>
              <th className="px-3 py-2 text-right">Warm</th>
              <th className="px-3 py-2 text-right">Cold</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No leads match.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.label} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-semibold">{r.hot}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.warm}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cold}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">
          <Flame className="size-6 text-rose-500" /> Hot leads
        </h1>
        <Link href="/dashboard/leads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to leads
        </Link>
      </div>

      <form method="get" className="card-surface p-3 flex flex-wrap items-end gap-3 text-xs">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Lead temperature</span>
          <select name="band" defaultValue={band} className="input-base block">
            <option value="">Hot, warm and cold</option>
            <option value="hot">Hot only</option>
            <option value="warm">Warm only</option>
            <option value="cold">Cold only</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Event</span>
          <select name="event" defaultValue={event} className="input-base block max-w-[220px]">
            <option value="">All events</option>
            {data.events.map((e: any) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Branch</span>
          <select name="unit" defaultValue={unit} className="input-base block max-w-[220px]">
            <option value="">All branches</option>
            {data.units.map((u: any) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Owner (RM)</span>
          <select name="owner" defaultValue={owner} className="input-base block max-w-[220px]">
            <option value="">All owners</option>
            {data.owners.map((o: any) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary text-xs">
          Apply
        </button>
        <Link href="/dashboard/leads/hot" className="text-xs text-muted-foreground hover:underline pb-2">
          Clear
        </Link>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["hot", "warm", "cold"] as const).map((b) => (
          <div key={b} className="card-surface p-4">
            <div className="text-xs text-muted-foreground capitalize">{b} leads</div>
            <div className="text-2xl font-bold mt-1 tabular-nums">{data.counts[b]}</div>
          </div>
        ))}
        <div className="card-surface p-4">
          <div className="text-xs text-muted-foreground">All open leads</div>
          <div className="text-2xl font-bold mt-1 tabular-nums">{total}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Event-wise leads" rows={data.byEvent} />
        <Table title="Branch-wise leads" rows={data.byUnit} />
      </div>

      <div className="card-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b font-medium text-sm">
          Leads {band ? `· ${band}` : "· hottest first"} <span className="text-muted-foreground font-normal">(top 100)</span>
        </div>
        <div className="table-scroll">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Lead</th>
                <th className="px-3 py-2 text-left">Temperature</th>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Event</th>
                <th className="px-3 py-2 text-left">Branch</th>
                <th className="px-3 py-2 text-left">Owner</th>
              </tr>
            </thead>
            <tbody>
              {data.list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No leads match these filters.
                  </td>
                </tr>
              ) : (
                data.list.map((l: any) => (
                  <tr key={l.id} className="border-t hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/leads/${l.id}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{l.phone ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip capitalize ${BAND_TONE[l.score_band] ?? ""}`}>{l.score_band}</span>
                    </td>
                    <td className="px-3 py-2 capitalize">{String(l.stage ?? "").replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{l.source_campaign ?? "—"}</td>
                    <td className="px-3 py-2">{l.unit_name ?? "—"}</td>
                    <td className="px-3 py-2">{l.owner_name ?? "Unassigned"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
