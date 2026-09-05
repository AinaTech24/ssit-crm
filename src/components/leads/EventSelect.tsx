"use client";

/**
 * Event picker for the New-lead form (source = "event").
 *
 * A plain <SelectField> can't do this: each row needs its OWN delete control,
 * so an RM can clear out a mistyped or finished event without first selecting
 * it. Native <option> elements can't hold a button, hence this small purpose-
 * built listbox. Styling deliberately mirrors components/ui/Select so it sits
 * with the rest of the form.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Trash2 } from "lucide-react";

export type LeadEvent = { key: string; label: string };

export function EventSelect({
  events,
  value,
  onChange,
  onDelete,
  disabled,
}: {
  /** null while the list is still loading. */
  events: LeadEvent[] | null;
  /** The selected event's LABEL (what gets stored on the lead). */
  value: string;
  onChange: (label: string) => void;
  /** Resolves once the event is gone; rejects/throws are handled by the caller. */
  onDelete: (ev: LeadEvent) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function remove(ev: LeadEvent) {
    setDeleting(ev.key);
    try {
      await onDelete(ev);
    } finally {
      setDeleting(null);
    }
  }

  const placeholder =
    events === null
      ? "Loading events…"
      : events.length === 0
        ? "No events yet — use “Add event”"
        : "Select the event…";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full inline-flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm transition hover:border-brand-cyan/60 disabled:opacity-50"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {value || placeholder}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto scrollbar-none card-elevated bg-card p-1 animate-scale-in origin-top"
        >
          <li>
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent transition"
            >
              <span className="truncate">{placeholder}</span>
              {!value && <Check className="size-3.5 shrink-0 text-brand-cyan" />}
            </button>
          </li>

          {(events ?? []).map((ev) => {
            const isSel = ev.label === value;
            const busy = deleting === ev.key;
            return (
              <li key={ev.key} className="group flex items-center gap-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => { onChange(ev.label); setOpen(false); }}
                  className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-accent ${
                    isSel ? "bg-accent/60 font-medium" : ""
                  }`}
                >
                  <span className="truncate">{ev.label}</span>
                  {isSel && <Check className="size-3.5 shrink-0 text-brand-cyan" />}
                </button>
                {/* Per-row delete — the whole point of this component. Kept
                    always-visible on touch (group-hover alone would hide it). */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); remove(ev); }}
                  title={`Remove "${ev.label}" from the event list`}
                  aria-label={`Remove ${ev.label} from the event list`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground/70 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
