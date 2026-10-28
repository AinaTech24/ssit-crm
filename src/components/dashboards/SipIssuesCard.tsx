/**
 * SIP bounce + SIP rejected, as two headline cards.
 *
 *   Bounced   — an installment of a running SIP that did not debit (the marks the
 *               SIP Tracker's installment watch records as "bounced").
 *   Rejected  — a SIP rejection the RTA reported (sip_rejections), with how many
 *               are still open and the amount at stake.
 *
 * Counted under the viewer's client wall, so an RM sees their own clients, a
 * branch head their branch, the owner the firm.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlertTriangle, XCircle } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSqlOrOwn } from "@/lib/investors/access";
import { SIP_OPEN_STATUSES } from "@/db/schema/sip_rejections";

type Rec = Record<string, any>;
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export async function SipIssuesCard({ session, targetUserId }: { session: SessionUser; targetUserId?: string }) {
  let d: { bounced: number; bouncedMtd: number; rejected: number; rejectedMtd: number; rejectedOpen: number; atStake: number };
  try {
    d = await withTenant(
      session.tenantId,
      async (tx) => {
        const wall = await investorScopeSqlOrOwn(tx, session, "inv");
        const rmOnly = targetUserId && /^[0-9a-f-]{36}$/i.test(targetUserId) ? sql`inv.rm_id = ${targetUserId}::uuid` : sql`TRUE`;
        const open = sql.join(SIP_OPEN_STATUSES.map((s) => sql`${s}`), sql`, `);
        const [b, r] = await Promise.all([
          tx.execute(sql`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE m.updated_at >= date_trunc('month', now()))::int AS mtd
              FROM sip_installment_marks m
              JOIN sips s ON s.id = m.sip_id
              JOIN investors inv ON inv.id = s.investor_id
             WHERE m.tenant_id = ${session.tenantId}::uuid AND m.status = 'bounced'
               AND m.updated_at >= now() - interval '90 days'
               AND ${wall} AND ${rmOnly}`),
          tx.execute(sql`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE sr.rejection_date >= date_trunc('month', now())::date)::int AS mtd,
                   COUNT(*) FILTER (WHERE sr.recovery_status IN (${open}))::int AS open_n,
                   COALESCE(SUM(sr.rejection_amount) FILTER (WHERE sr.recovery_status IN (${open})), 0)::numeric AS at_stake
              FROM sip_rejections sr
              JOIN investors inv ON inv.id = sr.investor_id
             WHERE sr.tenant_id = ${session.tenantId}::uuid
               AND sr.rejection_date >= current_date - 90
               AND ${wall} AND ${rmOnly}`),
        ]);
        const br = b.rows[0] as Rec;
        const rr = r.rows[0] as Rec;
        return {
          bounced: Number(br?.total ?? 0),
          bouncedMtd: Number(br?.mtd ?? 0),
          rejected: Number(rr?.total ?? 0),
          rejectedMtd: Number(rr?.mtd ?? 0),
          rejectedOpen: Number(rr?.open_n ?? 0),
          atStake: Number(rr?.at_stake ?? 0),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
  } catch (err) {
    console.error("[sip-issues-card] failed", err instanceof Error ? err.message : err);
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Link href="/dashboard/sips" className="rounded-xl border bg-card p-4 hover:bg-secondary/30 transition-colors">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="size-3.5 text-amber-600" /> SIP bounced
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{d.bounced}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {d.bouncedMtd} this month · installments that did not debit (last 90 days)
        </div>
      </Link>
      <Link href="/dashboard/sip-rejections" className="rounded-xl border bg-card p-4 hover:bg-secondary/30 transition-colors">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <XCircle className="size-3.5 text-rose-600" /> SIP rejected
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{d.rejected}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {d.rejectedMtd} this month · {d.rejectedOpen} still open
          {d.atStake > 0 ? ` · ${inr(d.atStake)} to recover` : ""}
        </div>
      </Link>
    </div>
  );
}
