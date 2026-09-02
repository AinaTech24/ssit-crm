"use client";

/**
 * TaskWatchersDeps — followers (watchers) + the "blocked by" dependency for a
 * task, shown together in the detail drawer.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Link2, X, Search, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Employee = { id: string; name: string };
type Watcher = { userId: string; name: string | null };
type BlockerTask = { id: string; title: string; status: string };

function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function TaskWatchersDeps({
  taskId,
  currentUserId,
  initialBlockedById,
  onChanged,
}: {
  taskId: string;
  currentUserId: string;
  initialBlockedById: string | null;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [youWatch, setYouWatch] = useState(false);
  const [team, setTeam] = useState<Employee[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  // Blocked-by dependency.
  const [blocker, setBlocker] = useState<BlockerTask | null>(null);
  const [depQ, setDepQ] = useState("");
  const [depResults, setDepResults] = useState<BlockerTask[]>([]);
  const [depSearching, setDepSearching] = useState(false);
  const depBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/watchers`).then((r) => r.json()).then((j) => {
      if (Array.isArray(j.watchers)) setWatchers(j.watchers);
      setYouWatch(!!j.youWatch);
    }).catch(() => {});
    fetch(`/api/employees`).then((r) => r.json()).then((j) => setTeam((j.rows ?? []) as Employee[])).catch(() => {});
    if (initialBlockedById) {
      fetch(`/api/tasks/${initialBlockedById}`).then((r) => (r.ok ? r.json() : null)).then((t) => {
        if (t?.id) setBlocker({ id: t.id, title: t.title, status: t.status });
      }).catch(() => {});
    }
  }, [taskId, initialBlockedById]);

  async function reloadWatchers() {
    const j = await fetch(`/api/tasks/${taskId}/watchers`).then((r) => r.json()).catch(() => ({}));
    if (Array.isArray(j.watchers)) setWatchers(j.watchers);
    setYouWatch(!!j.youWatch);
  }

  async function toggleSelfWatch() {
    try {
      if (youWatch) {
        await fetch(`/api/tasks/${taskId}/watchers?userId=${currentUserId}`, { method: "DELETE" });
      } else {
        await fetch(`/api/tasks/${taskId}/watchers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      }
      await reloadWatchers();
    } catch {
      toast.error("Couldn't update watch state");
    }
  }

  async function addWatcher(userId: string) {
    setAddOpen(false);
    try {
      const res = await fetch(`/api/tasks/${taskId}/watchers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      if (!res.ok) throw new Error();
      await reloadWatchers();
    } catch {
      toast.error("Couldn't add watcher");
    }
  }
  async function removeWatcher(userId: string) {
    try {
      await fetch(`/api/tasks/${taskId}/watchers?userId=${userId}`, { method: "DELETE" });
      await reloadWatchers();
    } catch {
      toast.error("Couldn't remove watcher");
    }
  }

  // Dependency search (debounced).
  useEffect(() => {
    const q = depQ.trim();
    if (q.length < 2) { setDepResults([]); return; }
    setDepSearching(true);
    const t = setTimeout(async () => {
      try {
        const j = await fetch(`/api/tasks?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.json());
        const list = (Array.isArray(j.tasks) ? j.tasks : []).filter((x: any) => x.id !== taskId).map((x: any) => ({ id: x.id, title: x.title, status: x.status }));
        setDepResults(list);
      } finally {
        setDepSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [depQ, taskId]);

  async function setBlockedBy(next: BlockerTask | null) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockedByTaskId: next?.id ?? null }) });
      if (!res.ok) throw new Error();
      setBlocker(next);
      setDepQ("");
      setDepResults([]);
      onChanged?.();
    } catch {
      toast.error("Couldn't update dependency");
    }
  }

  const blockerOpen = blocker && blocker.status !== "completed" && blocker.status !== "cancelled";

  return (
    <div className="space-y-4">
      {/* Watchers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
            <Eye className="size-3.5" /> Watchers
          </h4>
          <button type="button" onClick={toggleSelfWatch} className={`text-[11px] inline-flex items-center gap-1 rounded px-1.5 py-0.5 border ${youWatch ? "bg-brand-cyan-light/50 text-brand-cyan-deep border-brand-cyan/20" : "text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
            {youWatch ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {youWatch ? "Unfollow" : "Follow"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {watchers.map((w) => (
            <span key={w.userId} className="group inline-flex items-center gap-1 rounded-full bg-slate-100 pl-1 pr-1.5 py-0.5 text-[11px] text-slate-600" title={w.name ?? ""}>
              <span className="size-4 rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-[8px] font-bold flex items-center justify-center">{initials(w.name)}</span>
              {w.userId === currentUserId ? "You" : w.name}
              <button type="button" onClick={() => removeWatcher(w.userId)} className="text-slate-300 hover:text-rose-600" aria-label="Remove watcher"><X className="size-2.5" /></button>
            </span>
          ))}
          <div className="relative">
            <button type="button" onClick={() => setAddOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50">
              <Plus className="size-3" /> Add
            </button>
            {addOpen && (
              <ul className="absolute left-0 top-full mt-1 z-50 w-52 max-h-52 overflow-y-auto scrollbar-thin card-elevated bg-card p-1">
                {team.filter((e) => !watchers.some((w) => w.userId === e.id)).map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => addWatcher(e.id)} className="w-full text-left rounded px-2 py-1.5 hover:bg-secondary text-xs flex items-center gap-2">
                      <span className="size-5 rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-[9px] font-bold flex items-center justify-center">{initials(e.name)}</span>
                      {e.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Blocked by */}
      <div className="space-y-2" ref={depBox}>
        <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
          <Link2 className="size-3.5" /> Blocked by
        </h4>
        {blocker ? (
          <div className={`rounded-lg border p-2.5 flex items-center gap-2 ${blockerOpen ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            {blockerOpen && <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />}
            <span className="text-xs flex-1 min-w-0 truncate">{blocker.title}</span>
            <span className="text-[10px] uppercase font-semibold text-slate-500">{blocker.status.replace(/_/g, " ")}</span>
            <button type="button" onClick={() => setBlockedBy(null)} className="text-slate-400 hover:text-rose-600" aria-label="Clear dependency"><X className="size-3.5" /></button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input value={depQ} onChange={(e) => setDepQ(e.target.value)} placeholder="Search a task that blocks this…" className="input-base text-xs pl-8 h-8 bg-white" />
            {depSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-brand-cyan" />}
            {depResults.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto scrollbar-thin card-elevated bg-card p-1">
                {depResults.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setBlockedBy(r)} className="w-full text-left rounded px-2 py-1.5 hover:bg-secondary text-xs flex items-center justify-between gap-2">
                      <span className="truncate">{r.title}</span>
                      <span className="text-[10px] uppercase text-slate-400 shrink-0">{r.status.replace(/_/g, " ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
