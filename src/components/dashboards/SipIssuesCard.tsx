/**
 * SIP bounced and SIP rejected, as two separate tables.
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
  let d: { bouncedRows: Rec[]; rejectedRows: Rec[]; bounced: number; rejected: number; rejectedOpen: number; atStake: number };
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
        const bounced = b.rows as Rec[];
        const rejected = r.rows as Rec[];
        const openRows = rejected.filter((x) => x.is_open);
        return {
          bouncedRows: bounced.slice(0, 12),
          rejectedRows: rejected.slice(0, 12),
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
    <div className="space-y-4">
      <IssueTable
        title="SIP bounced"
        note="installments that did not debit · last 90 days"
        stats={[{ label: "Bounced", value: String(d.bounced) }]}
        link={{ href: "/dashboard/sips/at-risk", label: "SIP tracker" }}
        statusHeading="Installment"
        empty="No bounced SIP installments in the last 90 days."
        rows={d.bouncedRows}
      />
      <IssueTable
        title="SIP rejected"
        note="rejections reported by the RTA · last 90 days"
        stats={[
          { label: "Rejected", value: String(d.rejected) },
          { label: "Open", value: String(d.rejectedOpen) },
          ...(d.atStake > 0 ? [{ label: "To recover", value: inr(d.atStake) }] : []),
        ]}
        link={{ href: "/dashboard/sip-rejections", label: "All rejections" }}
        statusHeading="Status"
        empty="No rejected SIPs in the last 90 days."
        rows={d.rejectedRows}
      />
    </div>
  );
}

function IssueTable({
  title,
  note,
  stats,
  link,
  statusHeading,
  empty,
  rows,
}: {
  title: string;
  note: string;
  stats: { label: string; value: string }[];
  link: { href: string; label: string };
  statusHeading: string;
  empty: string;
  rows: Rec[];
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-muted-foreground" /> {title}
          <span className="text-xs font-normal text-muted-foreground">{note}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {stats.map((s) => (
            <span key={s.label}>
              {s.label} <b className="text-foreground tabular-nums">{s.value}</b>
            </span>
          ))}
          <Link href={link.href} className="hover:underline">
            {link.label}
          </Link>
        </div>
      </div>
      <div className="table-scroll">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Scheme</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">RM</th>
              <th className="px-3 py-2 text-left">{statusHeading}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((x, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/investors/${x.investor_id}`} className="font-medium hover:underline">
                      {x.client}
                    </Link>
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
