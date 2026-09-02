import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowLeft, MessageSquare, CheckCircle2, AlertCircle } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "branch_head", "ops"];

/**
 * Copilot Insights — how the team uses SSIT CRM Copilot and, crucially, the
 * "miss queue": questions it couldn't answer yet, so you know what to teach it
 * next. Read-only aggregates over ai_copilot_interactions (PII already redacted
 * at write time). Owner / branch-head / ops only.
 */
export default async function CopilotInsightsPage() {
  const session = await requireSession();
  const allowed = session.roles?.some((r) => ALLOWED.includes(r));

  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="text-lg font-semibold">Copilot Insights</div>
        <p className="text-sm text-muted-foreground mt-2">
          These analytics are available to owners, branch heads and operations. Ask your admin if you need access.
        </p>
        <Link href="/dashboard/ai-assistant" className="inline-flex items-center gap-1.5 text-sm text-brand-cyan-deep font-medium mt-4 hover:underline">
          <ArrowLeft className="size-4" /> Back to Copilot
        </Link>
      </div>
    );
  }

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const totals = await tx.execute(sql`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE handled)::int AS handled,
               COUNT(*) FILTER (WHERE created_at >= now() - interval '14 days')::int AS last14
        FROM ai_copilot_interactions WHERE tenant_id = ${session.tenantId}::uuid`);
      const byIntent = await tx.execute(sql`
        SELECT COALESCE(intent,'—') AS intent, COUNT(*)::int AS c
        FROM ai_copilot_interactions
        WHERE tenant_id = ${session.tenantId}::uuid AND handled AND intent IS NOT NULL AND intent <> 'refusal'
        GROUP BY intent ORDER BY c DESC LIMIT 15`);
      const topQ = await tx.execute(sql`
        SELECT question_norm AS q, COUNT(*)::int AS c
        FROM ai_copilot_interactions
        WHERE tenant_id = ${session.tenantId}::uuid AND handled
        GROUP BY question_norm ORDER BY c DESC LIMIT 12`);
      const misses = await tx.execute(sql`
        SELECT question_norm AS q, COUNT(*)::int AS c, MAX(created_at)::date AS last
        FROM ai_copilot_interactions
        WHERE tenant_id = ${session.tenantId}::uuid AND NOT handled
        GROUP BY question_norm ORDER BY c DESC, last DESC LIMIT 25`);
      return {
        totals: (totals.rows[0] as any) ?? { total: 0, handled: 0, last14: 0 },
        byIntent: byIntent.rows as any[],
        topQ: topQ.rows as any[],
        misses: misses.rows as any[],
      };
    },
    { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
  );

  const total = Number(data.totals.total) || 0;
  const handled = Number(data.totals.handled) || 0;
  const pct = total ? Math.round((handled / total) * 100) : 0;
  const intentLabel: Record<string, string> = {
    greeting: "Greetings", thanks: "Thanks / acks", help: "Help / capabilities", customer_360: "Client 360",
    client_list: "Client lists", breakdown: "Breakdowns", business: "Business", birthdays: "Birthdays",
    renewals: "Renewals", meetings: "Meetings", data_quality: "Data quality", trend: "Trends",
    rm_performance: "RM performance", draft: "Message drafts", metric: "Metrics",
  };
  const maxIntent = Math.max(...data.byIntent.map((r) => Number(r.c)), 1);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Copilot Insights</div>
          <p className="text-sm text-muted-foreground">How your team uses SSIT CRM Copilot — and what to teach it next.</p>
        </div>
        <Link href="/dashboard/ai-assistant" className="inline-flex items-center gap-1.5 text-sm text-brand-cyan-deep font-medium hover:underline">
          <ArrowLeft className="size-4" /> Back to Copilot
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card icon={<MessageSquare className="size-4" />} label="Questions asked" value={total.toLocaleString("en-IN")} sub={`${Number(data.totals.last14).toLocaleString("en-IN")} in last 14 days`} />
        <Card icon={<CheckCircle2 className="size-4 text-emerald-600" />} label="Answered on our engine" value={`${pct}%`} sub={`${handled.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`} />
        <Card icon={<AlertCircle className="size-4 text-amber-600" />} label="Couldn't answer yet" value={(total - handled).toLocaleString("en-IN")} sub="the miss queue below" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Intents */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold mb-3">What people ask about</div>
          {data.byIntent.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-2">
              {data.byIntent.map((r) => (
                <div key={r.intent} className="flex items-center gap-2 text-sm">
                  <div className="w-28 shrink-0 truncate text-muted-foreground">{intentLabel[r.intent] ?? r.intent}</div>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${(Number(r.c) / maxIntent) * 100}%` }} />
                  </div>
                  <div className="w-8 text-right tabular-nums">{r.c}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top questions */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold mb-3">Most-asked questions</div>
          {data.topQ.length === 0 ? (
            <Empty />
          ) : (
            <ol className="space-y-1.5 text-sm">
              {data.topQ.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground tabular-nums w-6 shrink-0">{r.c}×</span>
                  <span className="min-w-0 flex-1 truncate">{r.q}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Miss queue */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-semibold mb-1">Miss queue — questions it couldn't answer</div>
        <p className="text-xs text-muted-foreground mb-3">These are the gaps. Tell us which of these matter and we'll teach the copilot to handle them.</p>
        {data.misses.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">🎉 Nothing here — every question so far was answered.</div>
        ) : (
          <div className="overflow-x-auto scrollbar-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left">
                  <th className="py-1.5 pr-3 font-medium">Question</th>
                  <th className="py-1.5 px-3 font-medium text-right">Times</th>
                  <th className="py-1.5 pl-3 font-medium text-right">Last asked</th>
                </tr>
              </thead>
              <tbody>
                {data.misses.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3">{r.q}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{r.c}</td>
                    <td className="py-1.5 pl-3 text-right text-muted-foreground whitespace-nowrap">{r.last ? new Date(r.last).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-muted-foreground py-2">No data yet — usage will appear here as your team chats.</div>;
}
