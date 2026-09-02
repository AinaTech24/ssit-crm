"use client";

/**
 * Themed multi-select — branded replacement for a native <select multiple>.
 * Button trigger (shows chips / "N selected") + a portalled checkbox list.
 * No Cmd/Ctrl-click; tick as many as you like. Matches <Select>'s chrome.
 *
 *   <MultiSelectField values={vals} onChange={setVals} options={opts} max={5} />
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X } from "lucide-react";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
type Opt = { value: string; label: string };

export function MultiSelectField({
  values,
  onChange,
  options,
  placeholder = "Select…",
  max,
  className = "",
  searchable = true,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: Opt[];
  placeholder?: string;
  max?: number;
  className?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.filter((o) => values.includes(o.value));
  const visible = searchable && query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const atMax = max != null && values.length >= max;

  function reposition() {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const flip = window.innerHeight - r.bottom < 300 && r.top > 300;
    const s: React.CSSProperties = { position: "fixed", zIndex: 200, minWidth: Math.round(r.width), left: Math.round(r.left) };
    if (flip) s.bottom = Math.round(window.innerHeight - r.top + 4);
    else s.top = Math.round(r.bottom + 4);
    setStyle(s);
  }

  useIso(() => {
    if (!open) { setQuery(""); return; }
    reposition();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onReflow = () => reposition();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(v: string) {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else if (!atMax) onChange([...values, v]);
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full min-h-[38px] inline-flex items-center justify-between gap-2 rounded-lg border bg-card shadow-sm px-2.5 py-1.5 text-sm transition
          ${open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : "border-border hover:bg-secondary/60"} focus:outline-none`}
      >
        <span className="flex flex-wrap gap-1 items-center min-w-0">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selected.map((o) => (
              <span key={o.value} className="inline-flex items-center gap-1 rounded-md bg-brand-cyan-light/60 text-brand-cyan-deep px-1.5 py-0.5 text-xs font-medium">
                {o.label}
                <X
                  className="size-3 hover:opacity-70"
                  onClick={(e) => { e.stopPropagation(); toggle(o.value); }}
                />
              </span>
            ))
          )}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={style}
          className="w-max max-w-[min(22rem,90vw)] card-elevated bg-card p-1 animate-scale-in"
        >
          {searchable && (
            <div className="p-1 border-b border-border mb-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:border-brand-cyan"
              />
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto scrollbar-thin">
            {visible.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">No matches</li>}
            {visible.map((o) => {
              const isSel = values.includes(o.value);
              const dis = !isSel && atMax;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    disabled={dis}
                    onClick={() => toggle(o.value)}
                    className={`w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition
                      ${isSel ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-semibold" : "text-foreground/80 hover:bg-secondary"}
                      disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <span className={`size-4 shrink-0 rounded border grid place-items-center ${isSel ? "bg-brand-cyan border-brand-cyan text-white" : "border-border"}`}>
                      {isSel && <Check className="size-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {max != null && (
            <div className="px-2.5 pt-1 mt-1 border-t border-border text-[10px] text-muted-foreground">
              {values.length}/{max} selected
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
