/**
 * Public read-only portfolio view — /portfolio/<token>.
 *
 * A login-free, mobile-friendly snapshot of the client's LIVE portfolio (value,
 * gain, XIRR, holdings, goal progress), shared by the RM via WhatsApp. This is
 * the lightweight "transparency without a portal" surface: the client can check
 * their portfolio any time without an account. The share token (kind
 * portfolio_view) is multi-use + long-lived, and can be revoked.
 *
 * No-auth route — resolveShareToken (withSystem) looks up the token; the
 * valuation is computed in the same system context (investor-scoped by id).
 */

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { withSystem } from "@/db/client";
import { tenants, investors } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { valueInvestorCached } from "@/lib/finance/valuation";
import { checkRateLimit } from "@/lib/rate-limit";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PublicPortfolioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Rate-limit by IP — this is an anonymous, shareable link; cap abuse / scraping.
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "anon").trim();
  const rl = checkRateLimit("public.portfolio", ip, { limit: 60, windowSec: 60 });
  if (!rl.ok) {
    return <ErrorScreen message="Too many requests — please wait a moment and refresh." />;
  }

  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    info = await resolveShareToken(token);
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "portfolio_view" || info.subjectType !== "investor") {
    return <ErrorScreen message="This link is not a portfolio view." />;
  }

  const data = await withSystem(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    const [inv] = await tx.select().from(investors).where(eq(investors.id, info.subjectId));
    if (!inv) return null;
    const valuation = await valueInvestorCached(tx, info.subjectId);
    const goalsRes = await tx.execute(sql`
      SELECT name, COALESCE(progress_pct,0)::numeric AS progress_pct, target_amount, status
      FROM goals WHERE investor_id = ${info.subjectId}::uuid
      ORDER BY COALESCE(target_amount,0) DESC LIMIT 6
    `);
    return { tenant: tenant as any, inv, valuation, goals: goalsRes.rows as any[] };
  });

  if (!data) return <ErrorScreen message="Portfolio not found." />;

  const { tenant, inv, valuation: v, goals } = data;
  const primary = tenant?.primaryColor || "#0e2557";
  const gainPositive = (v.gain ?? 0) >= 0;
  const priced = v.holdings.filter((h: any) => h.priced && (h.currentValue ?? 0) > 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 0 40px" }}>
        {/* Header */}
        <div style={{ background: primary, color: "white", padding: "22px 20px 26px" }}>
          <div style={{ fontSize: 12, opacity: 0.8, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
            {tenant?.displayName ?? tenant?.legalName ?? "Your Advisor"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>ARN {tenant?.arn ?? "—"}</div>
          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.85 }}>Portfolio for</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{inv.name}</div>
        </div>

        {/* Value card */}
        <div style={{ margin: "-16px 16px 0", background: "white", borderRadius: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", padding: 18 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            Current value
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{formatINR(v.currentValue)}</div>
          <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
            <Metric label="Invested" value={formatINR(v.pricedInvested)} />
            <Metric label="Gain" value={`${gainPositive ? "+" : ""}${formatINR(v.gain)}`} color={gainPositive ? "#059669" : "#dc2626"} />
            {v.xirr != null && (
              <Metric label="XIRR p.a." value={`${v.xirr >= 0 ? "+" : ""}${(v.xirr * 100).toFixed(1)}%`} color={v.xirr >= 0 ? "#059669" : "#dc2626"} />
            )}
          </div>
          {v.asOf && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 10 }}>As of {new Date(v.asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>}
        </div>

        {/* Goals */}
        {goals.length > 0 && (
          <div style={{ margin: "16px 16px 0", background: "white", borderRadius: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: primary, marginBottom: 10 }}>YOUR GOALS</div>
            {goals.map((g, i) => {
              const pct = Math.max(0, Math.min(100, Number(g.progress_pct ?? 0)));
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{g.name}</span>
                    <span style={{ color: "#64748b" }}>{pct.toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 8, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: pct >= 80 ? "#059669" : primary }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Holdings */}
        {priced.length > 0 && (
          <div style={{ margin: "16px 16px 0", background: "white", borderRadius: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", padding: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: primary, marginBottom: 10 }}>HOLDINGS</div>
            {priced.map((h: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ fontSize: 13, color: "#0f172a", paddingRight: 10 }}>{h.schemeName ?? h.schemeCode}</div>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{formatINR(h.currentValue)}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ margin: "18px 16px 0", fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
          {tenant?.legalName ?? tenant?.displayName ?? ""} · ARN {tenant?.arn ?? "—"} · Values are indicative, computed from
          recorded transactions priced at the latest available NAV. Mutual Fund investments are subject to market risks. Read all
          scheme related documents carefully.
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color ?? "#0f172a" }}>{value}</div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>Link unavailable</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>{message}</div>
      </div>
    </div>
  );
}
