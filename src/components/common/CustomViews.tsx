"use client";

/**
 * Zoho-CRM-style "Custom Views" picker for any list page.
 *
 *   - Renders a dropdown with the saved views + an "All <module>" default.
 *   - "Save current view" captures the current URL filter params under a
 *     user-given name.
 *   - "Edit"/"Delete" lets the user manage views.
 *   - Views are stored in localStorage keyed by `viewsKey` (per-module
 *     namespace) — no DB schema needed. A future v2 can move this to a
 *     `user_views` table without changing the UI.
 *
 * Designed to sit in the right-slot of <FilterBar>.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ListFilter, Plus, Star, Trash2, X, Check } from "lucide-react";

const PANEL_W = 288; // w-72

type SavedView = {
  id: string;
  name: string;
  /** URL search-param string, e.g. "status=open,in_progress&owner=u1" */
  params: string;
  pinned?: boolean;
  createdAt: number;
};

export function CustomViews({
  /** localStorage key, e.g. "views:investors". Should be unique per module. */
  viewsKey,
  /** Optional preset views the module ships with (read-only). */
  presets,
  /** Icon-only trigger (no "View:" label) — for compact toolbars. */
  // Icon-only by default — see the matching note in ColumnManager.
  compact = true,
}: {
  viewsKey: string;
  presets?: Array<{ id: string; name: string; params: string }>;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the (portaled) panel under the button, right-aligned but clamped
  // into the viewport so it never clips off-screen wherever the button sits.
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
      setPos({ top: r.bottom + 4, left });
    };
    compute();
    const onScroll = () => setOpen(false);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Load views on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(viewsKey);
      if (raw) setViews(JSON.parse(raw));
    } catch {
      setViews([]);
    }
  }, [viewsKey]);

  function persist(next: SavedView[]) {
    setViews(next);
    try {
      localStorage.setItem(viewsKey, JSON.stringify(next));
    } catch {
      /* localStorage full or disabled — ignore */
    }
  }

  function applyParams(params: string) {
    router.push(`${pathname}${params ? `?${params}` : ""}`);
    setOpen(false);
  }

  function saveCurrent() {
    const params = sp.toString();
    if (!name.trim()) return;
    const next: SavedView = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      params,
      createdAt: Date.now(),
    };
    persist([next, ...views]);
    setName("");
    setSaving(false);
  }

  function removeView(id: string) {
    persist(views.filter((v) => v.id !== id));
  }

  function togglePin(id: string) {
    persist(views.map((v) => (v.id === id ? { ...v, pinned: !v.pinned } : v)));
  }

  const currentParams = sp.toString();
  const activeView = views.find((v) => v.params === currentParams);
  const activePreset = !activeView ? presets?.find((p) => p.params === currentParams) : undefined;
  const activeLabel = activeView?.name ?? activePreset?.name ?? "All";

  return (
    <div className="relative">
      {compact ? (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((s) => !s)}
          title={`View: ${activeLabel}`}
          aria-label={`View: ${activeLabel}`}
          className={`relative inline-flex items-center justify-center rounded-lg border size-8 transition ${
            activeLabel !== "All" ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep" : "bg-card border-border hover:bg-secondary"
          }`}
        >
          <ListFilter className="size-4" />
          {activeLabel !== "All" && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-brand-cyan" />}
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-secondary px-2.5 h-8 text-xs font-medium"
        >
          <ListFilter className="size-3.5 text-brand-cyan" />
          <span className="opacity-70">View:</span>
          <span className="font-semibold">{activeLabel}</span>
          <span className="opacity-60 text-[10px]">▾</span>
        </button>
      )}

      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          {/* Click-outside backdrop */}
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div
            data-floating-popup
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            className="fixed z-[60] card-elevated overflow-hidden bg-card"
          >
            {/* Default / presets */}
            <div className="border-b border-border">
              <ViewItem
                label="All"
                active={!activeView && !activePreset}
                onClick={() => applyParams("")}
              />
              {presets?.map((p) => (
                <ViewItem
                  key={p.id}
                  label={p.name}
                  preset
                  active={activePreset?.id === p.id}
                  onClick={() => applyParams(p.params)}
                />
              ))}
            </div>

            {/* User views */}
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {views.length === 0 ? (
                <div className="p-3 text-[11px] text-muted-foreground text-center">
                  No saved views yet. Filter the list, then save this view ↓
                </div>
              ) : (
                views
                  .slice()
                  .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
                  .map((v) => (
                    <ViewItem
                      key={v.id}
                      label={v.name}
                      active={activeView?.id === v.id}
                      pinned={v.pinned}
                      onClick={() => applyParams(v.params)}
                      onPin={() => togglePin(v.id)}
                      onDelete={() => removeView(v.id)}
                    />
                  ))
              )}
            </div>

            {/* Save current */}
            <div className="border-t border-border p-2 bg-secondary/30">
              {saving ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCurrent();
                      if (e.key === "Escape") {
                        setSaving(false);
                        setName("");
                      }
                    }}
                    placeholder='Name (e.g. "My open HNI clients")'
                    className="input-base text-xs h-7 flex-1"
                  />
                  <button
                    onClick={saveCurrent}
                    disabled={!name.trim()}
                    className="btn-primary text-xs h-7 px-2"
                  >
                    <Check className="size-3" />
                  </button>
                  <button
                    onClick={() => {
                      setSaving(false);
                      setName("");
                    }}
                    className="btn-icon h-7"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSaving(true)}
                  disabled={!currentParams}
                  className="btn-ghost text-xs w-full justify-center disabled:opacity-40"
                  title={currentParams ? "Save the current filters as a named view" : "Apply some filters first"}
                >
                  <Plus className="size-3" />
                  {currentParams ? "Save current view" : "Apply filters to save a view"}
                </button>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function ViewItem({
  label,
  active,
  preset,
  pinned,
  onClick,
  onPin,
  onDelete,
}: {
  label: string;
  active?: boolean;
  preset?: boolean;
  pinned?: boolean;
  onClick: () => void;
  onPin?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-cyan-light/40 transition-colors ${
        active ? "bg-brand-cyan-light/60 font-semibold" : ""
      }`}
    >
      <button onClick={onClick} className="flex-1 min-w-0 text-left flex items-center gap-1.5">
        {pinned && <Star className="size-3 text-amber-500 flex-shrink-0 fill-amber-400" />}
        <span className="truncate">{label}</span>
        {preset && <span className="text-[9px] text-muted-foreground">· preset</span>}
      </button>
      {onPin && (
        <button
          onClick={onPin}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-500"
          title={pinned ? "Unpin" : "Pin to top"}
        >
          <Star className={`size-3 ${pinned ? "fill-amber-400 text-amber-500" : ""}`} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600"
          title="Delete view"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
