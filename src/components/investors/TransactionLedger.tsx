/**
 * Transaction ledger for the Client 360. Renders the client's recent
 * transactions (purchases / redemptions / switches / SIP installments / STP /
 * SWP) — the "what did we actually do" view an RM needs on a review call.
 *
 * Presentational + server-safe (no "use client"). The detail page loads the
 * rows (most-recent first, already limited) and passes them in.
 */

import { formatINR, formatDate } from "@/lib/utils";

type Tx = {
  id: string;
  orderDate: string | Date | null;
  type: string;
  direction: "inflow" | "outflow" | string | null;
  schemeName: string | null;
  amcName: string | null;
  amount: string | number | null;
  units: string | number | null;
  status: string;
  reasonDescription: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  purchase: "Purchase",
  lumpsum: "Purchase",
  redemption: "Redemption",
  switch: "Switch",
  sip: "SIP",
  sip_stop: "SIP Stop",
  sip_pause: "SIP Pause",
  stp: "STP",
  swp: "SWP",
  dividend_payout: "Dividend",
  dividend_reinvest: "Div. Reinvest",
};

const TYPE_TONE: Record<string, string> = {
  purchase: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lumpsum: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sip: "bg-sky-50 text-sky-700 border-sky-200",
  stp: "bg-sky-50 text-sky-700 border-sky-200",
  redemption: "bg-rose-50 text-rose-700 border-rose-200",
  swp: "bg-rose-50 text-rose-700 border-rose-200",
  switch: "bg-violet-50 text-violet-700 border-violet-200",
  sip_stop: "bg-amber-50 text-amber-700 border-amber-200",
  sip_pause: "bg-amber-50 text-amber-700 border-amber-200",
};

function statusTone(s: string): string {
  if (s === "processed" || s === "successful") return "bg-emerald-50 text-emerald-700";
  if (s === "rejected" || s === "failed" || s === "cancelled") return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700"; // pending / submitted
}

export function TransactionLedger({ transactions, total }: { transactions: Tx[]; total: number }) {
  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="font-semibold mb-3 flex items-center justify-between">
        <span>Transaction history</span>
        <span className="text-xs text-muted-foreground">
          {total === 0 ? "0" : `Latest ${transactions.length} of ${total}`}
        </span>
      </div>

      {transactions.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">
          No transactions recorded yet. They appear here once a purchase /
          redemption / SIP installment is booked or imported from CAMS/KFintech.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Scheme</th>
                <th className="text-right py-2 font-medium">Amount</th>
                <th className="text-left py-2 font-medium pl-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const isOut = t.direction === "outflow";
                const amt = Number(t.amount ?? 0);
                return (
                  <tr key={t.id} className="border-b last:border-0 align-top">
                    <td className="py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {t.orderDate ? formatDate(t.orderDate) : "—"}
                    </td>
                    <td className="py-2.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${TYPE_TONE[t.type] ?? "bg-muted"}`}>
                        {TYPE_LABEL[t.type] ?? t.type}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="text-sm">{t.schemeName ?? "—"}</div>
                      {t.amcName && <div className="text-[11px] text-muted-foreground">{t.amcName}</div>}
                      {(t.status === "rejected" || t.status === "failed") && t.reasonDescription && (
                        <div className="text-[11px] text-rose-600 mt-0.5">⚠ {t.reasonDescription}</div>
                      )}
                    </td>
                    <td className={`py-2.5 text-right tabular-nums font-medium ${isOut ? "text-rose-600" : "text-emerald-700"}`}>
                      {amt > 0 ? `${isOut ? "−" : "+"}${formatINR(amt)}` : "—"}
                    </td>
                    <td className="py-2.5 pl-4">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full capitalize ${statusTone(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
