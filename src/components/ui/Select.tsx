"use client";

/**
 * Custom select / dropdown — a branded, accessible replacement for the native
 * <select>. Button trigger + popup listbox, keyboard navigable, no black focus
 * outline. Drop-in API: `value` + `onChange(value)` + `options`.
 *
 *   <Select value={v} onChange={setV} options={[{value:"a",label:"A"}]} />
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

// Position the menu BEFORE the browser paints (no first-frame jump/stutter when
// opening). Falls back to useEffect during SSR to avoid the layout-effect warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className = "",
  menuClassName = "",
  ariaLabel,
  size = "md",
  id,
  searchable = false,
  searchPlaceholder = "Search…",
  leadingIcon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  id?: string;
  /** Show a filter box at the top of the menu (handy for long lists). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Optional icon rendered *inside* the trigger, before the label (e.g. a sort glyph). */
  leadingIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [flipUp, setFlipUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const rafRef = useRef<number | null>(null);

  const selected = options.find((o) => o.value === value);
  const visible =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;

  // Position the (portalled) menu in viewport-fixed coords from the trigger
  // rect, so NO overflow:hidden/auto ancestor (a task-row card, the filter bar,
  // the pipeline board) can clip it. Flips above the trigger near the viewport
  // bottom; aligns to the trigger's right edge near the right of the screen.
  function reposition() {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const alignRight = window.innerWidth - rect.left < 256;
    const flip = window.innerHeight - rect.bottom < 280 && rect.top > 280;
    // Cap minWidth at the menu's own max-width (mirrors the max-w-[min(20rem,90vw)]
    // class). Without this, a very wide trigger forces minWidth past max-width
    // (min-width wins in CSS) and the popup sprawls across the page, overlapping
    // the sidebar / side rails.
    const maxMenuW = Math.min(320, Math.round(window.innerWidth * 0.9));
    const style: React.CSSProperties = {
      position: "fixed",
      // Above modals/drawers (which sit at z-[100]) so a Select used inside a
      // modal opens in front of it, not hidden behind it.
      zIndex: 200,
      minWidth: Math.min(Math.round(rect.width), maxMenuW),
    };
    if (alignRight) style.right = Math.round(Math.max(8, window.innerWidth - rect.right));
    else style.left = Math.round(rect.left);
    // Anchor by `bottom` when flipping so the exact menu height isn't needed.
    // A 2px seam keeps the menu visually attached to the trigger (no floating gap).
    if (flip) style.bottom = Math.round(window.innerHeight - rect.top + 2);
    else style.top = Math.round(rect.bottom + 2);
    setFlipUp(flip);
    setMenuStyle(style);
  }

  useIsoLayoutEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setActive(options.findIndex((o) => o.value === value));
    reposition();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Fixed coords go stale on scroll/resize — recompute so the menu tracks the
    // trigger (a scroll in any ancestor bubbles to this capture-phase listener).
    // Two guards keep this cheap: (1) scrolling INSIDE the open menu must not
    // reposition it — the trigger hasn't moved, and a getBoundingClientRect +
    // setState on every wheel frame is what made the list stutter; (2) coalesce
    // reflows to one per animation frame so a fast page-scroll can't queue many.
    const onReflow = (e?: Event) => {
      if (e && e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        reposition();
      });
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(i: number) {
    const o = visible[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(visible.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit(active);
      }
    }
  }

  // `md` mirrors `.input-base` exactly (px-3 py-2 text-sm → 38px tall) so the
  // custom control lines up flush with native <input>s sitting beside it.
  const sizes = size === "sm" ? "h-8 text-xs px-2.5" : "text-sm px-3 py-2";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((s) => !s)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        id={id}
        className={`w-full inline-flex items-center justify-between gap-2 rounded-lg border bg-card shadow-sm font-medium transition
          ${sizes}
          ${open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : "border-border hover:bg-secondary/60"}
          disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none`}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {leadingIcon}
          <span className={`truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <ul
          ref={menuRef}
          role="listbox"
          data-floating-popup
          style={menuStyle}
          className={`w-max max-w-[min(20rem,90vw)] max-h-72 overflow-y-auto scrollbar-none card-elevated bg-card p-1 animate-scale-in ${flipUp ? "origin-bottom" : "origin-top"} ${menuClassName}`}
        >
          {searchable && (
            <li className="sticky -top-1 bg-card px-1 pt-1 pb-1.5 -mx-1 -mt-1 mb-1 border-b border-border z-10">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(visible.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commit(active >= 0 ? active : 0);
                  } else if (e.key === "Escape") {
                    setOpen(false);
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:border-brand-cyan"
              />
            </li>
          )}
          {visible.length === 0 && (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">{searchable && query ? "No matches" : "No options"}</li>
          )}
          {visible.map((o, i) => {
            const isSel = o.value === value;
            return (
              <li key={o.value || `__${i}`} role="option" aria-selected={isSel}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition
                    ${i === active ? "bg-brand-cyan-light/60 text-brand-cyan-deep" : "text-foreground/80 hover:bg-secondary"}
                    ${isSel ? "font-semibold" : ""}
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <Check className="size-3.5 shrink-0 text-brand-cyan" />}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}
