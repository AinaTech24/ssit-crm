"use client";

/**
 * Drag-and-drop Kanban for the Leads pipeline.
 *
 * The server `LeadsPage` renders the full chrome (header, KPIs, pipeline
 * wrapper) and hands the raw rows to this client component, which:
 *   - groups them by stage (folding legacy aliases into spec keys)
 *   - renders the 8 stage columns as droppable zones
 *   - renders each card as draggable
 *   - on drop, optimistically updates local state and PATCHes
 *     /api/leads/[id] with the new stage; reverts on failure.
 */

import { useMemo, useState, useEffect, useRef } from "react";
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
import { Loader2, Flame, Clock, AlertCircle, X } from "lucide-react";
import { RowActions } from "@/components/common/RowActions";
import { formatRelative, formatINR } from "@/lib/utils";
import {
  leadTemperature,
  stageAgingDays,
  followUpOverdue,
  parseIntendedAmount,
  temperatureClasses,
} from "@/lib/leads/scoring";
import { ScheduleMeetingDialog } from "@/components/leads/LeadActions";

type LeadRow = {
  lead: {
    id: string;
    name: string;
    mobile?: string | null;
    phone?: string | null;
    stage: string;
    source: string;
    updatedAt: any;
    /** Extended fields for temperature + aging display — all optional so
     *  back-compat with callers that don't pass them is preserved. */
    stageChangedAt?: string | null;
    createdAt?: string | null;
    lastContactAt?: string | null;
    lastFollowUpAt?: string | null;
    nextFollowUpAt?: string | null;
    intendedAmount?: string | null;
    convertedInvestorId?: string | null;
    utmParams?: {
      source?: string;
      medium?: string;
      campaign?: string;
      term?: string;
      content?: string;
    } | null;
  };
  owner: string | null;
};

type Stage = {
  key: string;
  label: string;
  tone: string;
  aliases: readonly string[];
};

const TONE_STYLES: Record<
  string,
  { strip: string; bg: string; chip: string; text: string; ring: string }
> = {
  blue:    { strip: "bg-blue-500",    bg: "bg-blue-50/40",    chip: "bg-blue-50 text-blue-700",       text: "text-blue-700",    ring: "ring-blue-400" },
  cyan:    { strip: "bg-cyan-500",    bg: "bg-cyan-50/40",    chip: "bg-cyan-50 text-cyan-700",       text: "text-cyan-700",    ring: "ring-cyan-400" },
  amber:   { strip: "bg-amber-500",   bg: "bg-amber-50/40",   chip: "bg-amber-50 text-amber-700",     text: "text-amber-700",   ring: "ring-amber-400" },
  violet:  { strip: "bg-violet-500",  bg: "bg-violet-50/40",  chip: "bg-violet-50 text-violet-700",   text: "text-violet-700",  ring: "ring-violet-400" },
  indigo:  { strip: "bg-indigo-500",  bg: "bg-indigo-50/40",  chip: "bg-indigo-50 text-indigo-700",   text: "text-indigo-700",  ring: "ring-indigo-400" },
  emerald: { strip: "bg-emerald-500", bg: "bg-emerald-50/40", chip: "bg-emerald-50 text-emerald-700", text: "text-emerald-700", ring: "ring-emerald-400" },
  rose:    { strip: "bg-rose-500",    bg: "bg-rose-50/40",    chip: "bg-rose-50 text-rose-700",       text: "text-rose-700",    ring: "ring-rose-400" },
  slate:   { strip: "bg-slate-400",   bg: "bg-slate-50/40",   chip: "bg-slate-50 text-slate-700",     text: "text-slate-700",   ring: "ring-slate-400" },
};

const sourceColors: Record<string, string> = {
  website: "bg-blue-50 text-blue-700",
  referral: "bg-emerald-50 text-emerald-700",
  social_media: "bg-purple-50 text-purple-700",
  meta_ads: "bg-purple-50 text-purple-700",
  google: "bg-amber-50 text-amber-700",
  google_ads: "bg-amber-50 text-amber-700",
  cold_call: "bg-brand-cyan-light/50 text-brand-cyan-deep",
  existing_client: "bg-teal-50 text-teal-700",
  manual: "bg-gray-50 text-gray-700",
  walk_in: "bg-teal-50 text-teal-700",
  event: "bg-pink-50 text-pink-700",
  seminar: "bg-pink-50 text-pink-700",
  webinar: "bg-violet-50 text-violet-700",
  other: "bg-gray-50 text-gray-700",
};

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function LeadsKanban({
  stages,
  initialRows,
}: {
  stages: ReadonlyArray<Stage>;
  initialRows: LeadRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LeadRow[]>(initialRows);
  // Re-sync from the server after a router.refresh() (delete, convert, etc.) so a
  // removed lead's card disappears immediately instead of lingering in local state.
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Modal interception state
  const [pendingTransition, setPendingTransition] = useState<{
    leadId: string;
    leadName: string;
    dest: string;
    currentStage: string;
  } | null>(null);

  // Client-side pagination state for Kanban columns
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const byStage = useMemo(() => {
    const out: Record<string, LeadRow[]> = {};
    for (const s of stages) out[s.key] = [];
    for (const r of rows) {
      const raw = r.lead.stage;
      const col = stages.find((s) => s.key === raw || s.aliases.includes(raw))?.key ?? "new";
      out[col].push(r);
    }
    return out;
  }, [rows, stages]);

  const activeRow = activeId ? rows.find((r) => r.lead.id === activeId) ?? null : null;

  const getVisibleCount = (stageKey: string) => visibleCounts[stageKey] ?? 10;

  const loadMore = (stageKey: string) => {
    setVisibleCounts((prev) => ({
      ...prev,
      [stageKey]: (prev[stageKey] ?? 10) + 10,
    }));
  };

  async function advanceLeadStage(
    leadId: string,
    dest: string,
    currentStage: string,
    fields?: Record<string, any>
  ) {
    setSavingIds((s) => new Set(s).add(leadId));
    try {
      // Stage === blueprint. Advancing the blueprint mirrors the new
      // value back onto leads.stage server-side (engine.ts transitionTo),
      // so we don't need a separate PATCH.
      const res = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStageKey: dest,
          remarks: `Manual stage change via Kanban drag-and-drop.`,
          // Kanban drag = explicit admin override. Skip SOP graph so
          // sideways branch moves (e.g. call_back_later ↔ contact_in_future)
          // and out-of-order corrections work without prereq checks.
          force: true,
          fields,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // Revert
        setRows((prev) =>
          prev.map((r) =>
            r.lead.id === leadId
              ? { ...r, lead: { ...r.lead, stage: currentStage } }
              : r
          )
        );
        setError(j.error ?? `Failed to move lead (${res.status})`);
      } else {
        // Persisted server-side (leads.stage is mirrored from the blueprint).
        // Refresh the route so Next's client cache for /dashboard/leads is
        // re-fetched — otherwise opening a lead and hitting "back" would serve
        // the stale pre-drag payload and the card would snap to its old column.
        router.refresh();
      }
    } catch (err: any) {
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId
            ? { ...r, lead: { ...r.lead, stage: currentStage } }
            : r
        )
      );
      setError(err?.message ?? "Network error");
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(leadId);
        return n;
      });
    }
  }

  function handleCancelTransition() {
    if (!pendingTransition) return;
    const { leadId, currentStage } = pendingTransition;
    setRows((prev) =>
      prev.map((r) =>
        r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r
      )
    );
    setPendingTransition(null);
  }

  async function handleConfirmLost(lostReason: string) {
    if (!pendingTransition) return;
    const { leadId, dest, currentStage } = pendingTransition;
    setPendingTransition(null);
    await advanceLeadStage(leadId, dest, currentStage, {
      lostReason,
      lostAt: new Date().toISOString(),
    });
  }

  async function handleConfirmConvert(pan: string, segmentTag: string) {
    if (!pendingTransition) return;
    const { leadId, currentStage } = pendingTransition;
    setPendingTransition(null);
    setSavingIds((s) => new Set(s).add(leadId));
    try {
      const res = await fetch(`/api/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pan, segmentTag }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Revert the optimistic move — conversion didn't happen.
        setRows((prev) => prev.map((r) => (r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r)));
        setError(j.error ?? "Couldn't convert this lead to a client.");
        return;
      }
      // Converted → it's now a client (stage 'converted', off the pipeline) and
      // appears in the Clients table. Refresh to reflect it.
      router.refresh();
    } catch (e: any) {
      setRows((prev) => prev.map((r) => (r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: currentStage } } : r)));
      setError(e?.message ?? "Network error");
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        n.delete(leadId);
        return n;
      });
    }
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setError(null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const targetStage = e.over?.id ? String(e.over.id) : null;
    if (!targetStage) return;
    const current = rows.find((r) => r.lead.id === leadId);
    if (!current) return;
    const currentStage = current.lead.stage;
    // Resolve the destination by stage definition (in case the user dropped on
    // an alias). It's always one of the canonical stage keys.
    const dest = stages.find((s) => s.key === targetStage)?.key;
    if (!dest) return;
    if (dest === currentStage) return;

    // Handle interactive transitions first
    if (dest === "not_qualified") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      // Move card optimistically
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    if (dest === "meeting_scheduled") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      // Move card optimistically
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    // Winning a lead converts it to a client — collect the (mandatory) PAN first.
    if (dest === "won_lead") {
      setPendingTransition({
        leadId,
        leadName: current.lead.name,
        dest,
        currentStage,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
        )
      );
      return;
    }

    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        r.lead.id === leadId ? { ...r, lead: { ...r.lead, stage: dest } } : r
      )
    );
    await advanceLeadStage(leadId, dest, currentStage);
  }

  return (
    <>
      {error && (
        <div className="mb-2 mx-1 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
          {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        // Gentle horizontal edge auto-scroll. Vertical auto-scroll is off and
        // acceleration is low so the board creeps (not jumps) toward off-screen
        // stages — you can stop and drop on any middle column.
        autoScroll={{ enabled: true, threshold: { x: 0.12, y: 0 }, acceleration: 4, interval: 10 }}
      >
        {/* Trello-style horizontal scroller — each column is a fixed-width
           card. The page scrolls horizontally to reach the right-hand stages.
           No scroll-snap: snapping made the auto-scroll jump column-to-column
           during a drag, so you couldn't release on a middle stage. */}
        <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1">
          {stages.map((s) => {
            const tone = TONE_STYLES[s.tone];
            const items = byStage[s.key] ?? [];
            const visibleCount = getVisibleCount(s.key);
            return (
              <DroppableColumn key={s.key} stage={s} tone={tone} count={items.length}>
                {items.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-[11px] text-muted-foreground/70 italic">
                    Drop a lead here
                  </div>
                ) : (
                  <>
                    {items
                      .slice(0, visibleCount)
                      .map((row) => (
                        <DraggableCard
                          key={row.lead.id}
                          row={row}
                          saving={savingIds.has(row.lead.id)}
                          isDragging={activeId === row.lead.id}
                        />
                      ))}
                    {items.length > visibleCount && (
                      <Sentinel onVisible={() => loadMore(s.key)} />
                    )}
                  </>
                )}
              </DroppableColumn>
            );
          })}
        </div>

        {/* Floating drag preview */}
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="rounded-lg bg-card border border-brand-cyan shadow-glow-lg p-2.5 w-[260px] rotate-2 cursor-grabbing">
              <div className="flex items-start gap-2">
                <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                  {initialsOf(activeRow.lead.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground truncate text-[13px]">
                    {activeRow.lead.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">moving…</div>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Interactive modal for marking a lead lost */}
      {pendingTransition?.dest === "not_qualified" && (
        <LostReasonDialog
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onConfirm={handleConfirmLost}
        />
      )}

      {/* Interactive modal for scheduling a meeting */}
      {pendingTransition?.dest === "meeting_scheduled" && (
        <ScheduleMeetingDialog
          leadId={pendingTransition.leadId}
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onDone={() => {
            setPendingTransition(null);
            router.refresh();
          }}
        />
      )}

      {/* Winning a lead → convert to client (PAN required) */}
      {pendingTransition?.dest === "won_lead" && (
        <ConvertDialog
          leadName={pendingTransition.leadName}
          onClose={handleCancelTransition}
          onConfirm={handleConfirmConvert}
        />
      )}
    </>
  );
}

/* ─────────────────────── Droppable Column ─────────────────────── */

function DroppableColumn({
  stage,
  tone,
  count,
  children,
}: {
  stage: Stage;
  tone: typeof TONE_STYLES[string];
  count: number;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.key });
  return (
    <div
      ref={setNodeRef}
      className={`w-72 flex-shrink-0 rounded-xl border ${
        isOver ? `${tone.ring} ring-2 ring-offset-1 border-transparent` : "border-border/70"
      } ${tone.bg} flex flex-col transition-shadow duration-150`}
    >
      {/* Column header — always single-line. The label whitespace-nowrap so it never wraps. */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`size-2 rounded-full ${tone.strip} flex-shrink-0`} />
          <span
            className={`text-[12px] font-bold uppercase tracking-wide whitespace-nowrap ${tone.text}`}
          >
            {stage.label}
          </span>
        </div>
        <span
          className={`chip text-[10px] ${tone.chip} font-bold tabular-nums flex-shrink-0`}
        >
          {count}
        </span>
      </div>
      <div className={`h-0.5 ${tone.strip} mx-3 rounded-full opacity-60`} />
      <div className="p-2 space-y-2 flex-1 min-h-[120px]">{children}</div>
    </div>
  );
}

/* ─────────────────────── Draggable Card ─────────────────────── */

function DraggableCard({
  row,
  saving,
  isDragging,
}: {
  row: LeadRow;
  saving: boolean;
  isDragging: boolean;
}) {
  const { lead: l, owner } = row;
  const { attributes, listeners, setNodeRef } = useDraggable({ id: l.id });

  const temp = leadTemperature(l);
  let tempBorderCls = "border-l-[3px] border-l-slate-400";
  if (temp === "hot") {
    tempBorderCls = "border-l-[3px] border-l-rose-500 shadow-sm hover:shadow-glow-sm hover:shadow-rose-500/10";
  } else if (temp === "warm") {
    tempBorderCls = "border-l-[3px] border-l-amber-500";
  } else if (temp === "cold") {
    tempBorderCls = "border-l-[3px] border-l-sky-400";
  }

  // Whole card is grabbable. The "Open" link + RowActions stop pointer-down
  // propagation so clicking those doesn't accidentally start a drag.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group relative rounded-lg bg-card border p-2.5 text-xs transition-all duration-150 ${tempBorderCls} ${
        isDragging
          ? "opacity-30 border-brand-cyan"
          : "hover:shadow-md hover:-translate-y-0.5 border-border/70"
      }`}
    >
      {/* Saving spinner — pinned top-right while a PATCH is in flight */}
      {saving && (
        <Loader2 className="absolute top-1.5 right-1.5 size-3 animate-spin text-brand-cyan" />
      )}
      {/* Row actions — top-right, fades in on hover */}
      <div
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <RowActions
          editHref={`/dashboard/leads/${l.id}`}
          deleteUrl={`/api/leads/${l.id}`}
          itemLabel="lead"
          itemName={l.name}
          verb="Delete"
        />
      </div>

      {/* Top row — avatar + name + phone */}
      <div className="flex items-start gap-2 pr-5">
        <div className="size-8 rounded-full brand-gradient text-white grid place-items-center text-[11px] font-bold flex-shrink-0 shadow-sm relative">
          {initialsOf(l.name)}
          {/* Temperature dot — top-right corner of the avatar */}
          <span
            className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card ${temperatureClasses(leadTemperature(l)).dot}`}
            title={`${temperatureClasses(leadTemperature(l)).label} lead`}
          />
        </div>
        <div className="min-w-0 flex-1">
          {/* The link hugs the name (not the full row) and stays draggable: we
              don't stop pointer-down, so grabbing the name starts a card drag,
              while a plain click (no movement) still opens the lead. */}
          <Link
            href={`/dashboard/leads/${l.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-foreground text-[13px] inline-block max-w-full truncate align-bottom hover:underline"
          >
            {l.name}
          </Link>
          {(l.mobile || l.phone) && (
            <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
              {l.mobile ?? l.phone}
            </div>
          )}
        </div>
      </div>

      {/* Insight chips row — only renders chips that apply */}
      <CardInsightChips lead={l} />

      {/* Source chip + relative time */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <span className={`chip text-[10px] ${sourceColors[l.source] ?? "bg-muted"}`}>
          {l.source.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatRelative(l.updatedAt)}
        </span>
      </div>

      {/* Owner */}
      {owner && (
        <div className="mt-1.5 pt-1.5 border-t border-border/60 text-[10px] text-muted-foreground truncate">
          <span className="opacity-60">RM ·</span>{" "}
          <span className="font-medium text-foreground/80">{owner}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Insight chips strip — surfaces the highest-signal facts on the card:
 *   - intended-amount (₹) if known
 *   - aging-in-stage if stuck >7d
 *   - overdue-follow-up if applicable
 *
 * Renders nothing when none apply, so we don't add empty space to clean cards.
 */
function CardInsightChips({ lead }: { lead: LeadRow["lead"] }) {
  const aging = stageAgingDays(lead);
  const overdue = followUpOverdue(lead);
  const amt = parseIntendedAmount(lead.intendedAmount);

  const chips: React.ReactNode[] = [];
  const utmLabel = lead.utmParams?.campaign || lead.utmParams?.source;
  if (utmLabel) {
    chips.push(
      <span
        key="utm"
        className="chip text-[10px] inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 max-w-[160px] truncate"
        title={`UTM Campaign/Source: ${utmLabel}`}
      >
        📣 {utmLabel}
      </span>
    );
  }
  if (amt > 0) {
    chips.push(
      <span
        key="amt"
        className="chip text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200"
        title="Intended investment amount"
      >
        ₹ {formatINR(amt)}
      </span>
    );
  }
  if (aging != null && aging > 7) {
    const tone = aging > 14 ? "rose" : "amber";
    const cls =
      tone === "rose"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-amber-50 text-amber-700 border-amber-200";
    chips.push(
      <span
        key="age"
        className={`chip text-[10px] inline-flex items-center gap-1 border ${cls}`}
        title={`Stuck ${aging} days in current stage`}
      >
        <Clock className="size-2.5" />
        {aging}d
      </span>
    );
  }
  if (overdue === true) {
    chips.push(
      <span
        key="ovd"
        className="chip text-[10px] inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200"
        title="Next follow-up is overdue"
      >
        <AlertCircle className="size-2.5" />
        Overdue
      </span>
    );
  }
  // HOT_STAGES badge — only show if lead is meaningfully hot AND we have an amount or recent activity
  if (leadTemperature(lead) === "hot") {
    chips.push(
      <span
        key="hot"
        className="chip text-[10px] inline-flex items-center gap-1 bg-rose-100 text-rose-700 border border-rose-200 font-semibold"
        title="Hot lead — late funnel or imminent follow-up"
      >
        <Flame className="size-2.5" />
        Hot
      </span>
    );
  }
  if (lead.stage === "won_lead") {
    chips.push(
      <span
        key="ready_to_convert"
        className="chip text-[10px] inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold"
        title="Lead is won and ready to be converted to client"
      >
        ✨ Ready to Convert
      </span>
    );
  }

  if (chips.length === 0) return null;
  return <div className="mt-2 flex flex-wrap gap-1">{chips}</div>;
}

/* ─────────────────────── Lazy Loading Sentinel ─────────────────────── */

function Sentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible();
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [onVisible]);

  return <div ref={ref} className="h-1 my-1" />;
}

/* ─────────────────────── Lost Reason Dialog ─────────────────────── */

function LostReasonDialog({
  leadName,
  onClose,
  onConfirm,
}: {
  leadName: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  const presetReasons = [
    "Not interested in mutual funds/investing",
    "Already has another advisor/distributor",
    "High fees/pricing concerns",
    "Unable to contact / invalid details",
    "No surplus for investment right now",
    "Other",
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4">
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full flex flex-col p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Mark Lost · {leadName}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Specify the reason why this lead is not qualified or lost. This helps track conversions.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium mb-1">Reason for losing lead</label>
          <div className="space-y-1.5">
            {presetReasons.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="radio"
                  name="lostReason"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 accent-primary"
                />
                <span>{r}</span>
              </label>
            ))}
          </div>

          {reason === "Other" && (
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              rows={2}
              placeholder="Enter custom reason..."
              className="w-full mt-2 border rounded-md px-3 py-2 text-sm bg-background"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason === "Other" ? customReason : reason)}
            disabled={!reason || (reason === "Other" && !customReason.trim())}
            className="rounded-md bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
          >
            Mark Lost
          </button>
        </div>
      </div>
    </div>
  );
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const SEGMENTS = ["Retail", "Affluent", "HNI", "NRI", "Corporate"] as const;

function ConvertDialog({
  leadName,
  onClose,
  onConfirm,
}: {
  leadName: string;
  onClose: () => void;
  onConfirm: (pan: string, segmentTag: string) => void;
}) {
  const [pan, setPan] = useState("");
  const [segment, setSegment] = useState<string>("Retail");
  const valid = PAN_RE.test(pan);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-lg max-w-md w-full flex flex-col p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-base font-semibold text-foreground">Convert to client · {leadName}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Winning a lead onboards it as a client. PAN is mandatory (KYC). All the
            lead&apos;s data — risk profile, proposals, documents, messages — carries over.
          </p>
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">PAN <span className="text-rose-600">*</span></div>
          <input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
            placeholder="ABCDE1234F"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono tracking-wider"
            autoFocus
          />
          {pan.length > 0 && !valid && <p className="text-[11px] text-rose-600 mt-1">PAN must look like ABCDE1234F.</p>}
        </label>

        <label className="block">
          <div className="text-xs font-medium mb-1">Segment</div>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button
            onClick={() => onConfirm(pan, segment)}
            disabled={!valid}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Convert to client
          </button>
        </div>
      </div>
    </div>
  );
}
