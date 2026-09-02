"use client";

/**
 * ScenarioControls — save / reload calculator scenarios (backed by
 * /api/calculators/scenarios).
 *
 * Capture is GENERIC so it works across every calculator without per-calc
 * wiring: it snapshots the open calculator's DOM form state —
 *   • <input> (number/text/date) values + checkbox checked
 *   • <select> values
 *   • Segmented controls (via [data-calc-seg] + [data-active] from ui.tsx)
 * Restore replays segmented clicks first (they change which fields exist),
 * waits a frame, then sets field values through the native setter + an input
 * event so React's controlled state updates.
 *
 * Honest limitation: dynamically-added rows (extra payouts/goals) restore only
 * up to the rows currently on screen — the toast asks the RM to verify before
 * presenting.
 */

import { useEffect, useRef, useState } from "react";
import { Save, FolderOpen, Trash2, Loader2, X } from "lucide-react";
import { useToast } from "../ui/Toast";

type Snapshot = {
  v: 1;
  segs: Array<{ group: string; idx: number; active: string }>;
  fields: Array<{ idx: number; kind: "value" | "checked"; value: string | boolean }>;
};

type Scenario = {
  id: string;
  title: string;
  calculatorKey: string;
  createdAt: string;
  inputs: Snapshot;
};

function fieldEls(root: HTMLElement): Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> {
  return Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:not([type=file]), select, textarea"
    )
  );
}

function capture(root: HTMLElement): Snapshot {
  const segs = Array.from(root.querySelectorAll<HTMLElement>("[data-calc-seg]")).map((g, idx) => ({
    group: g.getAttribute("data-calc-seg") ?? "",
    idx,
    active: g.querySelector<HTMLElement>("[data-active]")?.textContent?.trim() ?? "",
  }));
  const fields = fieldEls(root).map((el, idx) =>
    el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
      ? { idx, kind: "checked" as const, value: el.checked }
      : { idx, kind: "value" as const, value: el.value }
  );
  return { v: 1, segs, fields };
}

/** Set a controlled input's value so React notices (native setter + event). */
function setNativeValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function restore(root: HTMLElement, snap: Snapshot) {
  // Phase 1 — segmented modes + checkboxes (these swap which fields render).
  const groups = Array.from(root.querySelectorAll<HTMLElement>("[data-calc-seg]"));
  for (const s of snap.segs) {
    const g = groups[s.idx];
    if (!g) continue;
    const btn = Array.from(g.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === s.active
    );
    if (btn && !btn.hasAttribute("data-active")) btn.click();
  }
  const checks = snap.fields.filter((f) => f.kind === "checked");
  let els = fieldEls(root);
  for (const f of checks) {
    const el = els[f.idx];
    if (el instanceof HTMLInputElement && el.checked !== f.value) el.click();
  }
  // Let React re-render the mode-dependent fields.
  await new Promise((r) => setTimeout(r, 50));
  // Phase 2 — values, by DOM order (deterministic once modes match).
  els = fieldEls(root);
  for (const f of snap.fields) {
    if (f.kind !== "value") continue;
    const el = els[f.idx];
    if (el && el.value !== String(f.value)) setNativeValue(el, String(f.value));
  }
}

export function ScenarioControls({
  calculatorKey,
  calculatorName,
  clientName,
  containerRef,
}: {
  calculatorKey: string;
  calculatorName: string;
  clientName?: string;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<Scenario[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function save() {
    const root = containerRef.current;
    if (!root) return;
    setBusy(true);
    try {
      const title =
        (clientName?.trim() ? `${clientName.trim()} — ` : "") +
        `${calculatorName} · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
      const res = await fetch("/api/calculators/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calculatorKey, title, inputs: capture(root) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      toast.success("Scenario saved", title);
    } catch (e: any) {
      toast.error("Couldn't save scenario", e?.message);
    } finally {
      setBusy(false);
    }
  }

  async function openList() {
    setOpen(true);
    setBusy(true);
    try {
      const res = await fetch(`/api/calculators/scenarios?calculatorKey=${encodeURIComponent(calculatorKey)}`);
      const j = await res.json().catch(() => ({}));
      setList(Array.isArray(j.scenarios) ? j.scenarios : []);
    } finally {
      setBusy(false);
    }
  }

  async function load(s: Scenario) {
    const root = containerRef.current;
    if (!root || !s.inputs || s.inputs.v !== 1) return;
    await restore(root, s.inputs);
    setOpen(false);
    toast.info("Scenario loaded", "Inputs restored — please verify values before presenting.");
  }

  async function remove(id: string) {
    await fetch(`/api/calculators/scenarios?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setList((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="relative print:hidden">
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="btn-ghost text-xs disabled:opacity-50" title="Save this scenario's inputs">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
        </button>
        <button onClick={openList} className="btn-ghost text-xs" title="Reload a saved scenario">
          <FolderOpen className="size-3.5" /> Scenarios
        </button>
      </div>

      {open && (
        <div ref={panelRef} className="absolute right-0 top-full mt-2 z-50 w-80 card-elevated bg-card p-2 animate-scale-in">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold">Saved scenarios — {calculatorName}</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          {busy ? (
            <div className="px-2 py-4 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : list.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              Nothing saved yet — set up the calculator and hit <strong>Save</strong>.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto scrollbar-thin">
              {list.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-secondary">
                  <button onClick={() => load(s)} className="flex-1 min-w-0 text-left">
                    <span className="block text-xs font-medium truncate">{s.title}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </button>
                  <button onClick={() => remove(s.id)} aria-label="Delete scenario" className="text-muted-foreground hover:text-rose-600">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
