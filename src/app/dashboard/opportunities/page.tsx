import Link from "next/link";
import { sql } from "drizzle-orm";
import { Target, Flame, ArrowLeftRight, PlusCircle, Users } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { investorScopeSqlOrOwn } from "@/lib/investors/access";
import { requireAnyOrNavGrant } from "@/lib/auth/nav-grant";
import { usersInScopeSql } from "@/lib/auth/data-scope";
import { ScopeFilterBar } from "@/components/common/ScopeFilterBar";
import { parseScope, scopeFilterSql, loadScopeUnits, loadScopeMembers, canPickScope } from "@/lib/scope/view-filter";
import { Avatar } from "@/components/ui/Avatar";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { Pager } from "@/components/common/Pager";
import { DashboardEmptyState } from "@/components/dashboards/DashboardEmptyState";
import {
  CROSS_SELL_PRODUCTS,
  CROSS_SELL_STATUSES,
  CROSS_SELL_OPPORTUNITY_STATUSES,
  crossSellOpportunities,
  crossSellStatusLabel,
  crossSellStatusTone,
  heldWithUsCount,
  type CrossSellMap,
} from "@/lib/investors/cross-sell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** One client row in the list. Shapes the raw `tx.execute` result. */
type OpportunityRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  segment_tag: string | null;
  aum: string | number | null;
  cross_sell: CrossSellMap | null;
  rm_name: string | null;
  score: number;
};

/** One (product, status) bucket of the per-product roll-up. */
type ProductStatusRow = { product: string; status: string; clients: number };

type RmRow = { id: string; name: string | null };

/**
 * Opportunities — every client with an OPEN wallet-share opportunity, firm-wide.
 *
 * The data already existed: the Client-360 "Cross-sell / holdings" card records
 * one status per product per client, and three of those statuses ("Interested",
 * "Held elsewhere", "Not held") mean there is business on the table. But it was
 * only ever readable one client at a time — there was no way to ask "who wants
 * NPS?" without opening 400 client pages. This is that question, inverted:
 * one row per client, the open products as chips, sorted hottest first.
 *
 * Source of truth stays `investors.cross_sell` and
 * `src/lib/investors/cross-sell.ts` — this page adds no second definition of
 * what counts as an opportunity, it just reads the same one in bulk. Editing
 * still happens on the client page, so this list never drifts from the card.
 *
 * Scoping: managers (investor.view.all) see the firm; an RM sees their own book,
 * matching every other client-derived list.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  await withTenant(session.tenantId, (tx) =>
    requireAnyOrNavGrant(tx, session, ["investor.view.all", "investor.view.assigned"], "/dashboard/opportunities")
  );
  const viewAll = can(session.roles, "investor.view.all", session.permissions);

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const productKeys = new Set(CROSS_SELL_PRODUCTS.map(([k]) => k as string));
  const productFilter = (sp.product ?? "").split(",").filter((v) => productKeys.has(v));
  const statusFilter = (sp.status ?? "")
    .split(",")
    .filter((v) => (CROSS_SELL_OPPORTUNITY_STATUSES as readonly string[]).includes(v));
  const rmFilter = (sp.rm ?? "").split(",").filter(Boolean);
  const scopeSel = parseScope(sp);
  const showScopePicker = canPickScope(session);
  const sort = ["score", "clients_az", "aum"].includes(sp.sort ?? "") ? (sp.sort as string) : "score";
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // The statuses/products an "open opportunity" is allowed to have for THIS
  // request. Both default to the full set, so an unfiltered page counts exactly
  // what crossSellOpportunities() would count client-side.
  const wantStatuses = statusFilter.length ? statusFilter : [...CROSS_SELL_OPPORTUNITY_STATUSES];
  const wantProducts = productFilter.length ? productFilter : [...productKeys];
  const statusArr = sql`ARRAY[${sql.join(wantStatuses.map((s) => sql`${s}`), sql`, `)}]::text[]`;
  const productArr = sql`ARRAY[${sql.join(wantProducts.map((p) => sql`${p}`), sql`, `)}]::text[]`;

  const data = await withTenant(session.tenantId, async (tx) => {
    // Which clients are even eligible — everything EXCEPT the product/status
    // predicate. Kept separate so the headline tiles can describe the whole
    // opportunity pool while the list below narrows to the active filters.
    const baseConds: any[] = [
      sql`i.deleted_at IS NULL`,
      sql`i.status = 'active'`,
      // jsonb_each_text() errors on a non-object, and cross_sell is a free-form
      // JSONB column — guard before unnesting it.
      sql`jsonb_typeof(i.cross_sell) = 'object'`,
    ];
    // The client data wall, not "investor.view.all ⇒ the whole firm": a
    // sub-branch head holding view-all was reading every other desk's clients.
    baseConds.push(await investorScopeSqlOrOwn(tx, session, "i"));
    baseConds.push(scopeFilterSql(scopeSel, session.tenantId, ["i.rm_id", "i.service_rm_id"]));
    if (q) baseConds.push(sql`(i.name ILIKE ${`%${q}%`} OR i.pan ILIKE ${`%${q}%`} OR i.email ILIKE ${`%${q}%`})`);
    if (rmFilter.length) {
      baseConds.push(sql`i.rm_id IN (${sql.join(rmFilter.map((r) => sql`${r}::uuid`), sql`, `)})`);
    }
    const conds = [
      ...baseConds,
      sql`EXISTS (
        SELECT 1 FROM jsonb_each_text(i.cross_sell) AS kv(k, v)
        WHERE v = ANY(${statusArr}) AND k = ANY(${productArr})
      )`,
    ];
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    // "Hotness" mirrors the STRENGTH table in lib/investors/cross-sell.ts:
    // interested (3) > held elsewhere (2) > not held (1). Summed per client so
    // one "Interested" outranks two lukewarm "Not held"s.
    const scoreSql = sql`(
      SELECT COALESCE(SUM(CASE kv.v WHEN 'interested' THEN 3 WHEN 'held_elsewhere' THEN 2 ELSE 1 END), 0)
      FROM jsonb_each_text(i.cross_sell) AS kv(k, v)
      WHERE kv.v = ANY(${statusArr}) AND kv.k = ANY(${productArr})
    )`;

    const orderSql =
      sort === "clients_az"
        ? sql`i.name ASC`
        : sort === "aum"
          ? sql`i.aum::numeric DESC NULLS LAST, i.name ASC`
          : sql`score DESC, i.aum::numeric DESC NULLS LAST, i.name ASC`;

    const rowsRes = await tx.execute(sql`
      SELECT i.id, i.name, i.avatar_url, i.pan, i.phone, i.email, i.segment_tag, i.service_tier,
             i.aum, i.active_sip_amount, i.cross_sell, u.name AS rm_name,
             ${scoreSql}::int AS score
      FROM investors i
      LEFT JOIN users u ON u.id = i.rm_id
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);

    const totalRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(i.aum::numeric), 0)::numeric AS aum
      FROM investors i
      ${whereSql}
    `);

    // Per-product roll-up across the SAME filtered population — "how many
    // clients want NPS" is the question this module exists to answer, and it
    // must be counted over every matching client, not just the current page.
    const byProductRes = await tx.execute(sql`
      SELECT kv.k AS product, kv.v AS status, COUNT(*)::int AS clients
      FROM investors i
      CROSS JOIN LATERAL jsonb_each_text(i.cross_sell) AS kv(k, v)
      ${whereSql}
        AND kv.v = ANY(${statusArr}) AND kv.k = ANY(${productArr})
      GROUP BY kv.k, kv.v
    `);

    // Headline counts are deliberately NOT product/status-filtered — they
    // describe the whole opportunity pool, so the tiles stay stable (and stay
    // usable as filter links) while you narrow the list.
    const summaryRes = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE kv.v = 'interested')::int AS interested,
        COUNT(*) FILTER (WHERE kv.v = 'held_elsewhere')::int AS held_elsewhere,
        COUNT(*) FILTER (WHERE kv.v = 'not_held')::int AS not_held
      FROM investors i
      CROSS JOIN LATERAL jsonb_each_text(i.cross_sell) AS kv(k, v)
      WHERE ${sql.join(baseConds, sql` AND `)}
        AND kv.v IN ('interested', 'held_elsewhere', 'not_held')
        AND kv.k = ANY(${sql`ARRAY[${sql.join([...productKeys].map((p) => sql`${p}`), sql`, `)}]::text[]`})
    `);

    const rmRes = viewAll
      ? await tx.execute(sql`
          SELECT DISTINCT u.id, u.name
          FROM users u
          WHERE u.tenant_id = ${session.tenantId}::uuid AND u.status = 'active'
            AND ${await usersInScopeSql(tx, session, "u")}
          ORDER BY u.name
        `)
      : { rows: [] };

    const totals = totalRes.rows[0] as { total?: number; aum?: string } | undefined;
    const summary = summaryRes.rows[0] as
      | { interested?: number; held_elsewhere?: number; not_held?: number }
      | undefined;

    const { units: scopeUnits } = showScopePicker ? await loadScopeUnits(tx, session) : { units: [] };
    const scopeMembers = showScopePicker ? await loadScopeMembers(tx, session, scopeSel) : [];
    return {
      scopeUnits,
      scopeMembers,
      rows: rowsRes.rows as unknown as OpportunityRow[],
      total: Number(totals?.total ?? 0),
      aum: Number(totals?.aum ?? 0),
      byProduct: byProductRes.rows as unknown as ProductStatusRow[],
      summary: summary ?? { interested: 0, held_elsewhere: 0, not_held: 0 },
      rms: rmRes.rows as unknown as RmRow[],
    };
  });

  // product -> { status -> clients }
  const productMatrix: Record<string, Record<string, number>> = {};
  for (const r of data.byProduct) {
    (productMatrix[String(r.product)] ??= {})[String(r.status)] = Number(r.clients);
  }
  const productRows = CROSS_SELL_PRODUCTS.map(([key, label]) => {
    const byStatus = productMatrix[key] ?? {};
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { key, label, byStatus, total };
  })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Target className="size-6 text-brand-cyan" /> Opportunities
        </h1>
        <p className="page-subtitle">
          Clients with an open wallet-share opportunity, read straight off the Cross-sell / holdings
          grid on each client page. Statuses are edited there — this is the firm-wide view of them.
          {!viewAll && " Showing your book only."}
        </p>
      </div>

      {showScopePicker && (
        <ScopeFilterBar
          basePath="/dashboard/opportunities"
          units={data.scopeUnits}
          members={data.scopeMembers}
          selectedUnit={scopeSel.unit}
          selectedMember={scopeSel.rm}
        />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Users}
          label="Clients with an opportunity"
          value={String(data.total)}
          sub={data.aum > 0 ? `${formatINR(data.aum)} AUM` : undefined}
        />
        {/* These three count OPEN PRODUCT LINES, not clients — one client
            with four open products contributes four. The client count is the
            first tile. */}
        <Stat
          icon={Flame}
          label="Interested"
          value={String(data.summary.interested ?? 0)}
          sub="Product lines the client asked about"
          tone="rose"
          href="/dashboard/opportunities?status=interested"
        />
        <Stat
          icon={ArrowLeftRight}
          label="Held elsewhere"
          value={String(data.summary.held_elsewhere ?? 0)}
          sub="Product lines bought from someone else"
          tone="amber"
          href="/dashboard/opportunities?status=held_elsewhere"
        />
        <Stat
          icon={PlusCircle}
          label="Not held"
          value={String(data.summary.not_held ?? 0)}
          sub="Product lines never offered"
          tone="sky"
          href="/dashboard/opportunities?status=not_held"
        />
      </div>

      {/* Which PRODUCT the demand is in — the buy-side of the same rows below. */}
      {productRows.length > 0 && (
        <div className="card-surface p-4">
          <div className="text-sm font-semibold mb-3">Open opportunities by product</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {productRows.map((p) => (
              <Link
                key={p.key}
                href={`/dashboard/opportunities?product=${p.key}`}
                className="rounded-lg border p-3 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{p.label}</span>
                  <span className="text-sm font-bold tabular-nums">{p.total}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {CROSS_SELL_OPPORTUNITY_STATUSES.map((s) =>
                    p.byStatus[s] ? (
                      <span key={s} className={`chip text-[10px] border ${crossSellStatusTone(s)}`}>
                        {crossSellStatusLabel(s)} {p.byStatus[s]}
                      </span>
                    ) : null
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <CompactFilterBar
        searchPlaceholder="Search client by name, PAN or email…"
        totalCount={data.total}
        sort={{
          key: "sort",
          options: [
            { value: "score", label: "Hottest first" },
            { value: "aum", label: "Largest AUM first" },
            { value: "clients_az", label: "Client A–Z" },
          ],
        }}
        filters={[
          {
            type: "multi" as const,
            key: "product",
            label: "Product",
            options: CROSS_SELL_PRODUCTS.map(([value, label]) => ({ value, label })),
          },
          {
            type: "multi" as const,
            key: "status",
            label: "Opportunity",
            options: CROSS_SELL_STATUSES.filter(([v]) =>
              (CROSS_SELL_OPPORTUNITY_STATUSES as readonly string[]).includes(v)
            ).map(([value, label]) => ({ value, label })),
          },
          ...(viewAll && data.rms.length
            ? [
                {
                  type: "multi" as const,
                  key: "rm",
                  label: "RM",
                  options: data.rms.map((r) => ({ value: String(r.id), label: r.name ?? "—" })),
                },
              ]
            : []),
        ]}
        rightSlot={
          <CustomViews
            compact
            viewsKey="views:opportunities"
            presets={[
              { id: "hot", name: "Interested (hot)", params: "status=interested" },
              { id: "convert", name: "Held elsewhere", params: "status=held_elsewhere" },
              { id: "insurance", name: "Insurance whitespace", params: "product=life_insurance,health_insurance,general_insurance" },
              { id: "wealth", name: "PMS / AIF / NPS", params: "product=pms,aif,nps" },
            ]}
          />
        }
      />

      {data.rows.length === 0 ? (
        <DashboardEmptyState
          title="No open opportunities"
          hint="Opportunities come from the Cross-sell / holdings card on a client page — mark a product as Interested, Held elsewhere or Not held and the client shows up here."
        />
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">RM</th>
                <th className="px-4 py-2.5 font-semibold text-right">AUM</th>
                <th className="px-4 py-2.5 font-semibold text-center">With us</th>
                <th className="px-4 py-2.5 font-semibold">Open opportunities</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.map((r) => {
                const map = (r.cross_sell ?? {}) as CrossSellMap;
                // Re-derived client-side from the SAME helper the client page
                // uses, then narrowed to the active filters so a filtered row
                // never shows chips that aren't what you filtered for.
                const opps = crossSellOpportunities(map).filter(
                  (o) =>
                    (!productFilter.length || productFilter.includes(o.key)) &&
                    (!statusFilter.length || statusFilter.includes(o.status))
                );
                return (
                  <tr key={r.id} className="hover:bg-accent/30 transition-colors align-top">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${r.id}`} className="flex items-center gap-2 hover:underline">
                        <Avatar src={r.avatar_url ? `/api/investors/${r.id}/avatar` : null} name={r.name} size={28} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          {r.segment_tag && (
                            <span className="block text-[11px] text-muted-foreground">{r.segment_tag}</span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.rm_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      {Number(r.aum ?? 0) > 0 ? formatINR(Number(r.aum)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{heldWithUsCount(map)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {opps.map((o) => (
                          <span key={o.key} className={`chip text-xs border ${crossSellStatusTone(o.status)}`}>
                            {o.label} · {crossSellStatusLabel(o.status)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <Pager page={page} totalPages={totalPages} total={data.total} pageSize={PAGE_SIZE} />
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "rose" | "amber" | "sky";
  href?: string;
}) {
  const color =
    tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "sky" ? "text-sky-600" : "text-foreground";
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card-surface p-4 hover:bg-accent/40 transition-colors">
      {body}
    </Link>
  ) : (
    <div className="card-surface p-4">{body}</div>
  );
}
