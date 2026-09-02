"use client";

/**
 * Interactive 6-cell installment strip for the New-SIP watch. Each cell shows the
 * feed-derived (or manually-marked) status; clicking opens a menu to set/clear a
 * manual mark (POST /api/sips/installment-mark) for cells the feed hasn't covered.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, AlertTriangle, Circle, Loader2 } from "lucide-react";
import type { InstallmentCell, CellStatus } from "@/lib/finance/sip-installment-watch";

const CELL_UI: Record<CellStatus, { icon: any; cls: string; title: string }> = {
  deducted: { icon: Check, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", title: "Deducted" },
  bounced: { icon: X, cls: "bg-rose-50 text-rose-700 border-rose-200", title: "Bounced" },
  missing: { icon: AlertTriangle, cls: "bg-amber-50 text-amber-700 border-amber-200", title: "Due — no record" },
  pending: { icon: Circle, cls: "bg-secondary text-muted-foreground border-border", title: "Not due yet" },
};

export function InstallmentWatchGrid({ sipId, cells }: { sipId: string; cells: InstallmentCell[] }) {
  return (
    <div className="flex items-center gap-1">
      {cells.map((c) => (
        <Cell key={c.no} sipId={sipId} cell={c} />
      ))}
    </div>
  );
}

function Cell({ sipId, cell }: { sipId: string; cell: InstallmentCell }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ui = CELL_UI[cell.status];
  const Icon = busy ? Loader2 : ui.icon;

  async function mark(status: CellStatus | null) {
    setOpen(false);
    setBusy(true);
    try {
      const res = await fetch("/api/sips/installment-mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sipId, installmentNo: cell.no, status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`#${cell.no} · ${cell.dueLabel} · ${ui.title}${cell.source === "manual" ? " (manual)" : ""}${cell.note ? ` · ${cell.note}` : ""}`}
        className={`size-7 rounded-md border flex items-center justify-center transition hover:ring-2 hover:ring-brand-cyan/30 ${ui.cls} ${cell.source === "manual" ? "ring-1 ring-brand-cyan/50" : ""}`}
      >
        <Icon className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>
      <div className="text-[9px] text-center text-muted-foreground mt-0.5 tabular-nums">{cell.dueLabel}</div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-8 left-0 w-36 card-surface p-1 shadow-lg text-xs">
            <div className="px-2 py-1 text-[10px] text-muted-foreground">Mark installment #{cell.no}</div>
            <MenuItem onClick={() => mark("deducted")} icon={Check} cls="text-emerald-700">Deducted</MenuItem>
            <MenuItem onClick={() => mark("bounced")} icon={X} cls="text-rose-700">Bounced</MenuItem>
            <MenuItem onClick={() => mark("pending")} icon={Circle} cls="text-muted-foreground">Pending</MenuItem>
            {cell.source === "manual" && (
              <MenuItem onClick={() => mark(null)} icon={Loader2} cls="text-brand-cyan border-t mt-1 pt-1.5">Clear (use feed)</MenuItem>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ onClick, icon: Icon, cls, children }: { onClick: () => void; icon: any; cls?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary text-left ${cls ?? ""}`}>
      <Icon className="size-3.5" /> {children}
    </button>
  );
}
