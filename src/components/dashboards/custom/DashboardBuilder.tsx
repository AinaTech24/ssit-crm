"use client";

/**
 * Dashboard builder — Zoho-style "Dashboard Builder". Left palette of widgets;
 * drag to reorder on a 4-column grid; per-widget size (W 1-4 × H 1-3), title
 * override, remove; board-level RM filter; Save. React-19-safe (no
 * react-grid-layout / findDOMNode) — drag is @dnd-kit, resize is span presets.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { GripVertical, X, Plus, Save, Loader2, Check, Maximize2, ChevronDown, BarChart3 } from "lucide-react";
import { WIDGET_META, WIDGET_CATEGORIES, type PlacedWidget } from "@/lib/dashboards/widgets";
import { WidgetView } from "./WidgetView";
import { CustomChartBuilder } from "./CustomChartBuilder";

type Member = { id: string; name: string };

interface Props {
  boardId: string;
  initialName: string;
  initialLayout: PlacedWidget[];
  initialRm?: string;
  members: Member[];
}

const uid = () => `w_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export function DashboardBuilder({ boardId, initialName, initialLayout, initialRm, members }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [layout, setLayout] = useState<PlacedWidget[]>(initialLayout);
  const [rm, setRm] = useState(initialRm ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [chartBuilder, setChartBuilder] = useState(false);

  function addCustomChart(config: any) {
    setLayout((l) => [
      ...l,
      { id: uid(), widgetKey: "custom_chart", colSpan: 2, rowSpan: 2, title: config.title, config },
    ]);
    setChartBuilder(false);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const inUse = useMemo(() => new Set(layout.map((w) => w.widgetKey)), [layout]);

  function addWidget(key: string) {
    const meta = WIDGET_META.find((m) => m.key === key);
    if (!meta) return;
    setLayout((l) => [...l, { id: uid(), widgetKey: key, colSpan: meta.defaultColSpan, rowSpan: meta.defaultRowSpan }]);
  }
  function removeWidget(id: string) {
    setLayout((l) => l.filter((w) => w.id !== id));
  }
  function setSize(id: string, field: "colSpan" | "rowSpan", v: number) {
    setLayout((l) => l.map((w) => (w.id === id ? { ...w, [field]: v } : w)));
  }
  function setWidgetRm(id: string, rmId: string) {
    setLayout((l) => l.map((w) => (w.id === id ? { ...w, config: { ...(w.config || {}), rm: rmId || undefined } } : w)));
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setLayout((l) => {
      const from = l.findIndex((w) => w.id === active.id);
      const to = l.findIndex((w) => w.id === over.id);
      return from < 0 || to < 0 ? l : arrayMove(l, from, to);
    });
  }

  async function save(goView = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, layout, filters: { rm: rm || undefined } }),
      });
      if (!res.ok) return;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (goView) router.push(`/dashboard/boards/${boardId}`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-bold tracking-tight bg-transparent border-b border-transparent hover:border-border focus:border-brand-cyan outline-none px-1 min-w-[220px]"
          placeholder="Dashboard name"
        />
        <div className="flex-1" />
        {members.length > 0 && (
          <select value={rm} onChange={(e) => setRm(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm bg-background" title="Scope widgets to one RM">
            <option value="">All RMs</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <button onClick={() => setChartBuilder(true)} className="btn-secondary text-xs inline-flex items-center gap-1">
          <BarChart3 className="size-4" /> Add component
        </button>
        <button onClick={() => setPaletteOpen((o) => !o)} className="btn-ghost text-xs inline-flex items-center gap-1">
          <Plus className="size-4" /> Widgets
        </button>
        <button onClick={() => save(false)} disabled={busy} className="btn-secondary text-sm inline-flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />} {saved ? "Saved" : "Save"}
        </button>
        <button onClick={() => save(true)} disabled={busy} className="btn-primary text-sm">Save &amp; view</button>
      </div>

      <div className="flex gap-3 items-start">
        {/* Palette */}
        {paletteOpen && (
          <aside className="w-56 shrink-0 border rounded-lg bg-card p-2 space-y-3 max-h-[75vh] overflow-auto scrollbar-thin">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Add a widget</div>
            {WIDGET_CATEGORIES.map((cat) => {
              const items = WIDGET_META.filter((m) => m.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1 mb-1">{cat}</div>
                  <div className="space-y-1">
                    {items.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => addWidget(m.key)}
                        className="w-full text-left rounded-md border px-2 py-1.5 text-xs hover:border-brand-cyan/60 hover:bg-accent transition-colors flex items-center justify-between gap-1"
                        title={m.desc}
                      >
                        <span className="truncate">{m.title}</span>
                        {inUse.has(m.key) ? <Check className="size-3 text-emerald-500 shrink-0" /> : <Plus className="size-3 text-muted-foreground shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </aside>
        )}

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          {layout.length === 0 ? (
            <div className="border-2 border-dashed rounded-xl p-12 text-center text-sm text-muted-foreground">
              Empty board — add widgets from the palette on the left.
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={layout.map((w) => w.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 [grid-auto-rows:minmax(140px,auto)]">
                  {layout.map((w) => (
                    <BuilderCard key={w.id} w={w} rm={rm} members={members} onRemove={() => removeWidget(w.id)} onSize={(f, v) => setSize(w.id, f, v)} onRm={(v) => setWidgetRm(w.id, v)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {chartBuilder && <CustomChartBuilder onClose={() => setChartBuilder(false)} onAdd={addCustomChart} />}
    </div>
  );
}

function BuilderCard({ w, rm, members, onRemove, onSize, onRm }: { w: PlacedWidget; rm: string; members: Member[]; onRemove: () => void; onSize: (f: "colSpan" | "rowSpan", v: number) => void; onRm: (v: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id });
  const [menu, setMenu] = useState(false);
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    gridColumn: `span ${Math.min(w.colSpan, 4)} / span ${Math.min(w.colSpan, 4)}`,
    gridRow: `span ${w.rowSpan} / span ${w.rowSpan}`,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`relative border rounded-lg bg-card p-2 flex flex-col ${isDragging ? "shadow-lg ring-2 ring-brand-cyan/40" : ""}`}>
      <div className="flex items-center justify-between gap-1 mb-1 shrink-0">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5 -ml-1" title="Drag to reorder">
          <GripVertical className="size-4" />
        </button>
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="p-1 rounded hover:bg-accent text-muted-foreground" title="Size">
              <Maximize2 className="size-3.5" /><ChevronDown className="size-3 inline" />
            </button>
            {menu && (
              <div className="absolute right-0 top-full mt-1 z-30 w-48 rounded-md border bg-popover shadow-md p-2 text-xs space-y-2">
                <SizeRow label="Width" value={w.colSpan} max={4} onPick={(v) => onSize("colSpan", v)} />
                <SizeRow label="Height" value={w.rowSpan} max={3} onPick={(v) => onSize("rowSpan", v)} />
                {members.length > 0 && (
                  <div className="pt-1 border-t">
                    <div className="text-muted-foreground mb-1">RM filter</div>
                    <select
                      value={(w.config?.rm as string) ?? ""}
                      onChange={(e) => onRm(e.target.value)}
                      className="w-full border rounded px-1.5 py-1 text-[11px] bg-background"
                    >
                      <option value="">Use board filter</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={onRemove} className="p-1 rounded hover:bg-rose-50 text-muted-foreground hover:text-rose-600" title="Remove">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 pointer-events-none">
        <WidgetView widgetKey={w.widgetKey} config={w.config} rm={(w.config?.rm as string) || rm || undefined} titleOverride={w.title} />
      </div>
    </div>
  );
}

function SizeRow({ label, value, max, onPick }: { label: string; value: number; max: number; onPick: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
          <button key={v} onClick={() => onPick(v)} className={`size-6 rounded text-[11px] font-medium ${value === v ? "bg-brand-cyan text-white" : "border hover:bg-accent"}`}>{v}</button>
        ))}
      </div>
    </div>
  );
}
