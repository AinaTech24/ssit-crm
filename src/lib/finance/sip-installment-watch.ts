/**
 * New-SIP installment watch (SIP Tracker). SERVER-ONLY.
 *
 * For every recently-started SIP, build the first-6-installments grid:
 *   ✓ deducted · ✗ bounced · ⃝ pending(not due) · ! missing(due, no record)
 * auto-derived from the CAMS/KFintech feed (transactions of type 'sip':
 * processed → deducted, rejected/failed → bounced), then overridden by any
 * manual marks (sip_installment_marks). Flags auto-pause risk from the trailing
 * run of consecutive misses — a new SIP that misses ~3 in a row gets auto-stopped
 * by the exchange/AMC, so this replaces the manual Excel watch.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type CellStatus = "deducted" | "bounced" | "pending" | "missing";
export type RiskLevel = "ok" | "watch" | "critical";

export type InstallmentCell = {
  no: number;
  dueISO: string;
  dueLabel: string;
  due: boolean; // due date is on/before today
  status: CellStatus;
  source: "feed" | "manual" | "none";
  note: string | null;
};

export type SipWatchRow = {
  sipId: string;
  investorId: string;
  investorName: string;
  schemeName: string;
  amcName: string;
  folioNumber: string | null;
  amount: number;
  frequency: string;
  sipStatus: string;
  rmName: string | null;
  startISO: string;
  cells: InstallmentCell[];
  installmentsDue: number;
  deductedCount: number;
  consecutiveMisses: number;
  risk: RiskLevel;
  riskReason: string;
};

export type SipInstallmentWatch = {
  rows: SipWatchRow[];
  kpis: { watched: number; atRisk: number; passedClean: number };
};

const WATCH_COUNT = 6; // first N installments
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── date helpers (UTC, avoid TZ drift) ──
const toUTC = (iso: string) => new Date(iso + "T00:00:00Z");
const todayUTC = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(d: Date, months: number, dayOfMonth?: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const targetDay = dayOfMonth ?? d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(targetDay, lastDay)));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const monthLabel = (d: Date) =>
  d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

function periodMonths(freq: string): number {
  return freq === "quarterly" ? 3 : freq === "yearly" ? 12 : 1; // monthly/weekly/fortnightly → monthly grid
}

/** transactions.status → installment cell status. */
function mapFeedStatus(s: string): CellStatus {
  if (s === "processed" || s === "successful") return "deducted";
  if (s === "rejected" || s === "failed" || s === "cancelled") return "bounced";
  return "pending"; // pending / submitted
}

type FeedTxn = { schemeCode: string | null; schemeName: string | null; folio: string | null; order: Date; status: CellStatus; reason: string | null };

export async function computeSipInstallmentWatch(
  tx: Tx,
  tenantId: string,
  opts: { rmId?: string | null } = {}
): Promise<SipInstallmentWatch> {
  // Non-managers see only their own book (SIPs they own OR for their clients).
  const scope = opts.rmId
    ? sql` AND (s.rm_id = ${opts.rmId}::uuid OR i.rm_id = ${opts.rmId}::uuid)`
    : sql``;
  // Recently-started SIPs still inside their first-6-installments window.
  const sipsRows = (
    await tx.execute(sql`
      SELECT s.id, s.investor_id, s.scheme_code, s.scheme_name, s.amc_name, s.folio_number,
             s.amount, s.frequency, s.sip_date, s.start_date, s.status,
             i.name AS investor_name, u.name AS rm_name
        FROM sips s
        JOIN investors i ON i.id = s.investor_id
        LEFT JOIN users u ON u.id = s.rm_id
       WHERE s.tenant_id = ${tenantId}::uuid
         AND i.deleted_at IS NULL
         AND s.start_date IS NOT NULL
         AND s.start_date >= current_date - interval '7 months'
         AND s.status NOT IN ('completed','expired')${scope}
       ORDER BY s.start_date DESC
    `)
  ).rows as any[];

  if (sipsRows.length === 0) return { rows: [], kpis: { watched: 0, atRisk: 0, passedClean: 0 } };

  const investorIds = Array.from(new Set(sipsRows.map((r) => r.investor_id)));
  const sipIds = sipsRows.map((r) => r.id);
  const idList = (ids: string[]) => sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);

  // SIP-installment transactions for those investors.
  const txnRows = (
    await tx.execute(sql`
      SELECT investor_id, scheme_code, scheme_name, folio_number, order_date, status, reason_description
        FROM transactions
       WHERE tenant_id = ${tenantId}::uuid
         AND type = 'sip'
         AND order_date >= current_date - interval '9 months'
         AND investor_id IN (${idList(investorIds)})
       ORDER BY order_date
    `)
  ).rows as any[];

  const txByInvestor = new Map<string, FeedTxn[]>();
  for (const t of txnRows) {
    if (!t.order_date) continue;
    const list = txByInvestor.get(t.investor_id) ?? [];
    list.push({
      schemeCode: t.scheme_code ?? null,
      schemeName: t.scheme_name ?? null,
      folio: t.folio_number ?? null,
      order: toUTC(String(t.order_date)),
      status: mapFeedStatus(String(t.status)),
      reason: t.reason_description ?? null,
    });
    txByInvestor.set(t.investor_id, list);
  }

  // Manual overrides.
  const marks = (
    await tx.execute(sql`
      SELECT sip_id, installment_no, status, note
        FROM sip_installment_marks
       WHERE tenant_id = ${tenantId}::uuid
         AND sip_id IN (${idList(sipIds)})
    `)
  ).rows as any[];
  const markBySip = new Map<string, Map<number, { status: CellStatus; note: string | null }>>();
  for (const m of marks) {
    const inner = markBySip.get(m.sip_id) ?? new Map();
    inner.set(Number(m.installment_no), { status: String(m.status) as CellStatus, note: m.note ?? null });
    markBySip.set(m.sip_id, inner);
  }

  const today = todayUTC();
  const rows: SipWatchRow[] = [];
  let passedClean = 0;

  for (const s of sipsRows) {
    const start = toUTC(String(s.start_date));
    const per = periodMonths(String(s.frequency));
    const sipDay = s.sip_date && /^\d+$/.test(String(s.sip_date)) ? Number(s.sip_date) : undefined;

    // 6 due dates + one trailing boundary for the last slot's window.
    const dues = Array.from({ length: WATCH_COUNT + 1 }, (_, k) => addMonths(start, k * per, sipDay));

    // Candidate feed txns for THIS sip: same investor + matching scheme (+ folio when both present).
    const cands = (txByInvestor.get(s.investor_id) ?? []).filter((t) => {
      const schemeMatch = s.scheme_code && t.schemeCode
        ? t.schemeCode === s.scheme_code
        : (t.schemeName ?? "").toLowerCase() === String(s.scheme_name ?? "").toLowerCase();
      const folioMatch = s.folio_number && t.folio ? t.folio === s.folio_number : true;
      return schemeMatch && folioMatch;
    });

    const marksForSip = markBySip.get(s.id);
    const cells: InstallmentCell[] = [];
    for (let k = 1; k <= WATCH_COUNT; k++) {
      const due = dues[k - 1];
      const slotStart = addDays(due, -5);
      const slotEnd = addDays(dues[k], -5);
      const isDue = due.getTime() <= today.getTime();

      const manual = marksForSip?.get(k);
      let status: CellStatus;
      let source: InstallmentCell["source"];
      let note: string | null = null;

      if (manual) {
        status = manual.status;
        source = "manual";
        note = manual.note;
      } else {
        // Feed txns landing in this installment's window; prefer a deduction.
        const inSlot = cands.filter((t) => t.order.getTime() >= slotStart.getTime() && t.order.getTime() < slotEnd.getTime());
        const hit = inSlot.find((t) => t.status === "deducted") ?? inSlot.find((t) => t.status === "bounced") ?? inSlot[0];
        if (hit) {
          status = hit.status;
          source = "feed";
          note = hit.reason;
        } else {
          status = isDue ? "missing" : "pending";
          source = "none";
        }
      }
      cells.push({ no: k, dueISO: iso(due), dueLabel: monthLabel(due), due: isDue, status, source, note });
    }

    const dueCells = cells.filter((c) => c.due);
    const deductedCount = cells.filter((c) => c.status === "deducted").length;

    // Trailing run of consecutive misses (bounced/missing) among DUE cells.
    let consecutiveMisses = 0;
    for (let i = dueCells.length - 1; i >= 0; i--) {
      if (dueCells[i].status === "bounced" || dueCells[i].status === "missing") consecutiveMisses++;
      else break;
    }
    const anyMiss = dueCells.some((c) => c.status === "bounced" || c.status === "missing");

    // Graduated — all 6 installments confirmed deducted → drop from the active watch.
    if (deductedCount === WATCH_COUNT) {
      passedClean++;
      continue;
    }

    const stuck = ["paused", "stopped", "rejected"].includes(String(s.status));
    let risk: RiskLevel = "ok";
    let riskReason = "On track";
    if (stuck) {
      risk = "critical";
      riskReason = `SIP ${s.status} — likely auto-stopped`;
    } else if (consecutiveMisses >= 3) {
      risk = "critical";
      riskReason = `${consecutiveMisses} consecutive misses — at auto-pause risk`;
    } else if (consecutiveMisses >= 2) {
      risk = "watch";
      riskReason = `${consecutiveMisses} consecutive misses`;
    } else if (anyMiss) {
      risk = "watch";
      riskReason = "An installment was missed";
    }

    rows.push({
      sipId: s.id,
      investorId: s.investor_id,
      investorName: s.investor_name ?? "—",
      schemeName: s.scheme_name ?? s.scheme_code ?? "—",
      amcName: s.amc_name ?? "—",
      folioNumber: s.folio_number ?? null,
      amount: num(s.amount),
      frequency: String(s.frequency),
      sipStatus: String(s.status),
      rmName: s.rm_name ?? null,
      startISO: iso(start),
      cells,
      installmentsDue: dueCells.length,
      deductedCount,
      consecutiveMisses,
      risk,
      riskReason,
    });
  }

  const rank: Record<RiskLevel, number> = { critical: 0, watch: 1, ok: 2 };
  rows.sort((a, b) => rank[a.risk] - rank[b.risk] || b.startISO.localeCompare(a.startISO));

  return {
    rows,
    kpis: { watched: rows.length, atRisk: rows.filter((r) => r.risk !== "ok").length, passedClean },
  };
}
