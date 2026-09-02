"use client";

/**
 * Drag-and-drop Kanban for the Clients (Investors) pipeline.
 *
 * Mirrors the leads Kanban pattern but groups by **client-phase** blueprint
 * stages only (orders 11-30 of the SOP):
 *
 *   Request Documents → Documents Pending → Documents Received →
 *   KYC Validated / Registered / Pending → Modify/Physical/Online KYC →
 *   UCC Create → UCC Activated → Mandate Create → Mandate Activated/Reject →
 *   Make Transaction → Transaction Successful/Failed → Family Mapping →
 *   Update Information → Active Client
 *
 * Cards represent a client. Dragging a card to another column calls
 * /api/leads/[leadId]/blueprint/advance — the lead's blueprint is the
 * source of truth even for client-phase stages because the same
 * instance carries through conversion.
 *
 * Direct-import clients (no source lead) sit in the "Active Client"
 * column and are not draggable since they don't have a real blueprint
 * instance behind them.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { formatINR, formatRelative } from "@/lib/utils";

export type InvestorRow = {
  investor: {
    id: string;
    name: string;
    pan: string;
    segmentTag: string | null;
    serviceTier: string | null;
    aum: string | null;
    activeSipAmount: string | null;
    kycStatus: string | null;
    status: string;
    updatedAt: any;
  };
  /** Source lead id — null for direct-import investors. */
  leadId: string | null;
  /** Current blueprint stage key (client-phase). Defaults to "add_in_review_sheet" for direct imports. */
  stageKey: string;
};

export type Stage = {
  key: string;
  label: string;
  tone: string;
};

export const CLIENT_PHASE_STAGES: Stage[] = [
  { key: "request_documents", label: "Request Documents", tone: "blue" },
  { key: "documents_pending", label: "Documents Pending", tone: "amber" },
  { key: "documents_received", label: "Documents Received", tone: "cyan" },
  { key: "kyc_validated", label: "KYC Validated", tone: "violet" },
  { key: "kyc_registered", label: "KYC Registered", tone: "violet" },
  { key: "kyc_pending", label: "KYC Pending", tone: "amber" },
  { key: "modify_kyc", label: "Modify KYC", tone: "amber" },
  { key: "physical_kyc", label: "Physical KYC", tone: "violet" },
  { key: "online_kyc", label: "Online KYC", tone: "violet" },
  { key: "ucc_create", label: "UCC Create", tone: "indigo" },
  { key: "ucc_activated", label: "UCC Activated", tone: "indigo" },
  { key: "mandate_create", label: "Mandate Create", tone: "indigo" },
  { key: "mandate_activated", label: "Mandate Activated", tone: "emerald" },
  { key: "mandate_reject", label: "Mandate Rejected", tone: "rose" },
  { key: "make_transaction", label: "Make Transaction", tone: "indigo" },
  { key: "transaction_successful", label: "Transaction Successful", tone: "emerald" },
  { key: "transaction_failed", label: "Transaction Failed", tone: "rose" },
  { key: "family_mapping", label: "Family Mapping", tone: "cyan" },
  { key: "update_information", label: "Update Information", tone: "cyan" },
  { key: "add_in_review_sheet", label: "Active Client", tone: "emerald" },
];

const TONE_BORDER: Record<string, string> = {
  blue: "border-blue-300",
  cyan: "border-cyan-300",
  amber: "border-amber-300",
  violet: "border-violet-300",
  indigo: "border-indigo-300",
  emerald: "border-emerald-300",
  rose: "border-rose-300",
};

export function InvestorsKanban({
  initialRows,
}: {
  initialRows: InvestorRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStage = useMemo(() => {
    const map: Record<string, InvestorRow[]> = {};
    for (const s of CLIENT_PHASE_STAGES) map[s.key] = [];
    for (const r of rows) {
      const key = r.stageKey && map[r.stageKey] ? r.stageKey : "add_in_review_sheet";
      map[key].push(r);
    }
    return map;
  }, [rows]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const invId = String(e.active.id);
    const targetStage = e.over?.id ? String(e.over.id) : null;
    if (!targetStage) return;
    const current = rows.find((r) => r.investor.id === invId);
    if (!current) return;
    if (current.stageKey === targetStage) return;
    if (!current.leadId) {
      // Direct-import — no source lead, no blueprint instance to advance.
      return;
    }

    setError(null);
    const previousStage = current.stageKey;
    setRows((prev) =>
      prev.map((r) =>
        r.investor.id === invId ? { ...r, stageKey: targetStage } : r
      )
    );
    setSavingIds((s) => new Set(s).add(invId));

    try {
      const res = await fetch(`/api/leads/${current.leadId}/blueprint/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStageKey: targetStage,
          remarks: "Manual stage change via Clients Kanban drag-and-drop.",
          // Kanban drag is an explicit admin-override — skip the SOP graph
          // and the multi-hop walk. Without this, dragging a card that's
          // still at a lead-phase stage (e.g. won_lead, where conversion
          // leaves it) to a client-phase column would fail.
          force: true,
        }),
      });
      if (!res.ok) {
        // Revert + surface the API error so the user knows why.
        const j = await res.json().catch(() => ({}));
        console.warn("[InvestorsKanban] advance failed:", j.error ?? res.status);
        setError(j.error ?? `Failed to move client stage (${res.status})`);
        setRows((prev) =>
          prev.map((r) =>
            r.investor.id === invId ? { ...r, stageKey: previousStage } : r
          )
        );
      } else {
        router.refresh();
      }
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(invId);
        return next;
      });
    }
  }

  const activeRow = rows.find((r) => r.investor.id === activeId);

  return (
    <>
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:opacity-70 text-sm font-semibold">✕</button>
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {CLIENT_PHASE_STAGES.map((s) => (
            <KanbanColumn
              key={s.key}
              stage={s}
              rows={byStage[s.key] ?? []}
              savingIds={savingIds}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeRow ? <InvestorCard row={activeRow} dragging /> : null}
      </DragOverlay>
    </DndContext>
    </>
  );
}

function KanbanColumn({
  stage,
  rows,
  savingIds,
}: {
  stage: Stage;
  rows: InvestorRow[];
  savingIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 rounded-xl border bg-card ${TONE_BORDER[stage.tone] ?? "border-border"} ${
        isOver ? "ring-2 ring-brand-cyan/40 bg-secondary/30" : ""
      }`}
    >
      <div className={`px-3 py-2 border-b ${TONE_BORDER[stage.tone] ?? "border-border"} flex items-center justify-between`}>
        <div className="text-xs font-bold uppercase tracking-wider">{stage.label}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">{rows.length}</div>
      </div>
      <div className="p-2 space-y-2 min-h-[120px] max-h-[70vh] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-6 italic">
            No clients here
          </div>
        ) : (
          rows.map((r) => (
            <InvestorCard key={r.investor.id} row={r} saving={savingIds.has(r.investor.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function InvestorCard({
  row,
  dragging,
  saving,
}: {
  row: InvestorRow;
  dragging?: boolean;
  saving?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.investor.id,
    disabled: !row.leadId, // direct-import clients aren't draggable
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const aum = row.investor.aum ? Number(row.investor.aum) : 0;
  const sip = row.investor.activeSipAmount ? Number(row.investor.activeSipAmount) : 0;
  const initials = row.investor.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group rounded-lg border bg-card p-2.5 ${
        row.leadId ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-90"
      } ${isDragging || dragging ? "opacity-50 shadow-xl" : "hover:shadow-md"} transition-shadow`}
    >
      <div className="flex items-start gap-2">
        <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/dashboard/investors/${row.investor.id}`}
            className="text-sm font-medium hover:underline truncate block"
            onClick={(e) => e.stopPropagation()}
          >
            {row.investor.name}
          </Link>
          <div className="text-[10px] font-mono text-muted-foreground">{row.investor.pan}</div>
        </div>
        {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">{aum > 0 ? `AUM ${formatINR(aum)}` : "—"}</span>
        <span className="tabular-nums">{sip > 0 ? `SIP ${formatINR(sip)}` : "—"}</span>
      </div>
      {row.investor.segmentTag && (
        <span className="mt-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
          {row.investor.segmentTag}
        </span>
      )}
      {!row.leadId && (
        <div className="mt-1.5 text-[9px] text-muted-foreground italic">
          Direct entry · pinned
        </div>
      )}
    </div>
  );
}
