"use client";

/**
 * GoalsBulkTable — the goal-planning list rendered through the generic
 * BulkTable so rows can be selected and bulk-archived (select-all → Archive →
 * clear). Per-row edit/archive stays available via RowActions in the last
 * column. Cell rendering mirrors the previous server-rendered table.
 */

import Link from "next/link";
import { Archive } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { categoryLabel } from "@/lib/goal-planning/calc";
import { RowActions } from "@/components/common/RowActions";
import { BulkTable, type BulkColumn, type BulkAction } from "@/components/common/BulkTable";
import { Avatar } from "@/components/ui/Avatar";

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700",
  on_track: "bg-emerald-50 text-emerald-700",
  behind_track: "bg-amber-50 text-amber-700",
  achieved: "bg-blue-50 text-blue-700",
  active: "bg-secondary text-foreground",
  on_hold: "bg-slate-50 text-slate-700",
  abandoned: "bg-rose-50 text-rose-700",
};

type Row = Record<string, any> & { id: string };

const actions: BulkAction[] = [{ kind: "delete", label: "Archive" }];

export function GoalsBulkTable({ rows }: { rows: Row[] }) {
  const columns: BulkColumn<Row>[] = [
    {
      key: "goal", header: "Goal", tdClass: "px-4 py-3",
      render: (g) => (
        <>
          <Link href={`/dashboard/goals/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
          <div className="text-xs text-muted-foreground">{categoryLabel(g.category)}</div>
        </>
      ),
    },
    {
      key: "investor", header: "Investor", tdClass: "py-3",
      render: (g) => (
        <div className="flex items-center gap-2">
          <Avatar src={g.investorAvatarUrl && g.investorId ? `/api/investors/${g.investorId}/avatar` : null} name={g.investorName} size={26} />
          <Link href={`/dashboard/investors/${g.investorId}`} className="hover:underline">{g.investorName ?? "—"}</Link>
        </div>
      ),
    },
    { key: "target", header: "Target", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap", render: (g) => formatINR(Number(g.targetAmount)) },
    { key: "linked", header: "Linked", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap text-muted-foreground", render: (g) => formatINR(Number(g.currentValue ?? 0)) },
    { key: "reqsip", header: "Req. SIP", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap", render: (g) => (g.requiredMonthlySip ? formatINR(Number(g.requiredMonthlySip)) : "—") },
    { key: "exsip", header: "Existing SIP", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap text-muted-foreground", render: (g) => (g.existingMonthlySip ? formatINR(Number(g.existingMonthlySip)) : "—") },
    {
      key: "gap", header: "Gap", thClass: "text-right py-2 font-medium", tdClass: "py-3 text-right tabular-nums whitespace-nowrap",
      render: (g) =>
        g.gapAmount && Number(g.gapAmount) > 0
          ? <span className="text-rose-600 font-medium">{formatINR(Number(g.gapAmount))}</span>
          : <span className="text-emerald-600">—</span>,
    },
    { key: "year", header: "Target yr", tdClass: "py-3 text-xs text-muted-foreground tabular-nums", render: (g) => new Date(g.targetDate).getFullYear() },
    {
      key: "status", header: "Status", tdClass: "py-3",
      render: (g) => <span className={`chip capitalize ${STATUS_TONE[g.status] ?? ""}`}>{String(g.status).replace(/_/g, " ")}</span>,
    },
    {
      key: "actions", header: "", thClass: "px-4 py-2", tdClass: "px-4 py-3 text-right",
      render: (g) => (
        <RowActions inline deleteIcon={Archive} editHref={`/dashboard/goals/${g.id}`} deleteUrl={`/api/goals/${g.id}`} itemLabel="goal" itemName={g.name} verb="Archive" />
      ),
    },
  ];

  return <BulkTable rows={rows} columns={columns} endpoint="/api/goals/bulk" actions={actions} itemLabel="goal" rowHref={(g) => `/dashboard/goals/${g.id}`} />;
}
