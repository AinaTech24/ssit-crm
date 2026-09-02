"use client";

/**
 * SaveCalcToClient — modal to store a branded calculator illustration PDF in a
 * client's document file (instead of only downloading it locally).
 *
 * Pick a client via a server-backed typeahead (GET /api/investors?q=), then
 * "Save to file" POSTs to /api/calculators/save-to-client. On success the PDF
 * appears in that investor's Documents section.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, FileDown, Loader2, User, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Hit = { id: string; name: string; pan?: string | null };
type CalcInput = { label: string; value: string; group?: string };

export function SaveCalcToClient({
  open,
  onClose,
  calcName,
  inputs,
  blocks,
}: {
  open: boolean;
  onClose: () => void;
  calcName: string;
  inputs?: CalcInput[];
  blocks: any[];
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Hit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state each time the modal opens, and focus the search box.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setSelected(null);
    setError(null);
    setBusy(false);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Escape to close (while not busy).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Debounced typeahead against the investors list endpoint.
  useEffect(() => {
    if (selected) return;
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/investors?q=${encodeURIComponent(q.trim())}&limit=8`);
        const j = await r.json().catch(() => ({}));
        if (!active) return;
        const rows = (Array.isArray(j.rows) ? j.rows : []) as Hit[];
        setHits(rows.slice(0, 8).map((x) => ({ id: x.id, name: x.name, pan: x.pan ?? null })));
      } catch {
        if (active) setHits([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 220);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, selected]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/calculators/save-to-client", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: selected.id, calcName, inputs: inputs ?? [], blocks }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? "Could not save to this client's file.");
        return;
      }
      toast.success(`Saved to ${selected.name}'s documents`);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not save to this client's file.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save calculator PDF to a client's file"
        className="relative card-elevated w-full max-w-md max-h-[85vh] overflow-y-auto p-5 animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-sm text-foreground">Save to a client's file</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stores the <strong>{calcName}</strong> illustration PDF in the client's Documents.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {selected ? (
          <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/30 px-3 py-2.5">
            <User className="size-4 text-brand-cyan-deep shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{selected.name}</div>
              {selected.pan && <div className="text-[11px] text-muted-foreground font-mono">{selected.pan}</div>}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
              disabled={busy}
              className="text-xs text-muted-foreground hover:text-rose-600 disabled:opacity-50"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search clients by name or PAN…"
              className="input-base h-9 text-sm pl-8 w-full"
            />
            {q.trim().length >= 2 && (
              <div className="mt-1 rounded-lg border border-border bg-card max-h-56 overflow-y-auto scrollbar-thin">
                {searching ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> Searching…
                  </div>
                ) : hits.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">No matching clients.</div>
                ) : (
                  <ul className="py-1">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(h);
                            setHits([]);
                            setQ("");
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan-light/40 transition-colors"
                        >
                          <span className="font-medium text-sm">{h.name}</span>
                          {h.pan && <span className="text-[11px] text-muted-foreground ml-2 font-mono">{h.pan}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 text-xs text-rose-700">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!selected || busy}
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            Save to file
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
