/**
 * SIP bounced + SIP rejected, as one table.
 *
 *   Bounced   — an installment of a running SIP that did not debit (the marks the
 *               SIP Tracker's installment watch records as "bounced").
 *   Rejected  — a SIP rejection the RTA reported (sip_rejections), with its
 *               recovery status and the amount at stake.
 *
 * Newest first, last 90 days, under the viewer's client wall — an RM sees their
 * own clients, a branch head their branch, the owner the firm.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSqlOrOwn } from "@/lib/investors/access";
import { SIP_OPEN_STATUSES } from "@/db/schema/sip_rejections";

type Rec = Record<string, any>;
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtDate = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export async function SipIssuesCard({ session, targetUserId }: { session: SessionUser; targetUserId?: string }) {
  let d: { rows: Rec[]; bounced: number; rejected: number; rejectedOpen: number; atStake: number };
  try {
    d = await withTenant(
      session.tenantId,
      async (tx) => {
        const wall = await investorScopeSqlOrOwn(tx, session, "inv");
        const rmOnly = targetUserId && /^[0-9a-f-]{36}$/i.test(targetUserId) ? sql`inv.rm_id = ${targetUserId}::uuid` : sql`TRUE`;
        const open = sql.join(SIP_OPEN_STATUSES.map((s) => sql`${s}`), sql`, `);
        const [b, r] = await Promise.all([
          tx.execute(sql`
            SELECT inv.id AS investor_id, inv.name AS client, rm.name AS rm_name, s.scheme_name,
                   s.amount::numeric AS amount, m.updated_at::date AS on_date,
                   'Installment ' || m.installment_no AS detail
              FROM sip_installment_marks m
              JOIN sips s ON s.id = m.sip_id
              JOIN investors inv ON inv.id = s.investor_id
              LEFT JOIN users rm ON rm.id = inv.rm_id
             WHERE m.tenant_id = ${session.tenantId}::uuid AND m.status = 'bounced'
               AND m.updated_at >= now() - interval '90 days'
               AND ${wall} AND ${rmOnly}
             ORDER BY m.updated_at DESC LIMIT 25`),
          tx.execute(sql`
            SELECT inv.id AS investor_id, inv.name AS client, rm.name AS rm_name, sr.scheme_name,
                   sr.rejection_amount::numeric AS amount, sr.rejection_date AS on_date,
                   sr.recovery_status AS detail,
                   (sr.recovery_status IN (${open})) AS is_open
              FROM sip_rejections sr
              JOIN investors inv ON inv.id = sr.investor_id
              LEFT JOIN users rm ON rm.id = inv.rm_id
             WHERE sr.tenant_id = ${session.tenantId}::uuid
               AND sr.rejection_date >= current_date - 90
               AND ${wall} AND ${rmOnly}
             ORDER BY sr.rejection_date DESC LIMIT 25`),
        ]);
        const bounced = (b.rows as Rec[]).map((x): Rec => ({ ...x, issue: "Bounced" }));
        const rejected = (r.rows as Rec[]).map((x): Rec => ({ ...x, issue: "Rejected" }));
        const rows = [...bounced, ...rejected]
          .sort((x, y) => String(y.on_date).localeCompare(String(x.on_date)))
          .slice(0, 12);
        const openRows = rejected.filter((x) => x.is_open);
        return {
          rows,
          bounced: bounced.length,
          rejected: rejected.length,
          rejectedOpen: openRows.length,
          atStake: openRows.reduce((s, x) => s + Number(x.amount ?? 0), 0),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
  } catch (err) {
    console.error("[sip-issues-card] failed", err instanceof Error ? err.message : err);
    return null;
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-muted-foreground" /> SIP bounced &amp; rejected
          <span className="text-xs font-normal text-muted-foreground">last 90 days</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Bounced <b className="text-foreground tabular-nums">{d.bounced}</b>
          </span>
          <span>
            Rejected <b className="text-foreground tabular-nums">{d.rejected}</b>
          </span>
          <span>
            Open <b className="text-foreground tabular-nums">{d.rejectedOpen}</b>
          </span>
          {d.atStake > 0 && (
            <span>
              To recover <b className="text-foreground tabular-nums">{inr(d.atStake)}</b>
            </span>
          )}
          <Link href="/dashboard/sip-rejections" className="hover:underline">
            All rejections
          </Link>
        </div>
      </div>
      <div className="table-scroll">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Issue</th>
              <th className="px-3 py-2 text-left">Scheme</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">RM</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No bounced or rejected SIPs in the last 90 days.
                </td>
              </tr>
            ) : (
              d.rows.map((x, i) => (
                <tr key={`${x.issue}-${i}`} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/investors/${x.investor_id}`} className="font-medium hover:underline">
                      {x.client}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="chip bg-secondary">{x.issue}</span>
                  </td>
                  <td className="px-3 py-2 max-w-[240px] truncate" title={x.scheme_name ?? ""}>
                    {x.scheme_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{x.amount != null ? inr(Number(x.amount)) : "—"}</td>
                  <td className="px-3 py-2">{fmtDate(x.on_date)}</td>
                  <td className="px-3 py-2">{x.rm_name ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{String(x.detail ?? "").replace(/_/g, " ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
