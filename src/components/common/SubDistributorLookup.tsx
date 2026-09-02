"use client";

/**
 * Sub-distributor lookup — typeahead picker. Used on the new-lead form
 * + anywhere else we want to attribute work to a sub-distributor.
 *
 * Filters to status='active' on the server side (the GET /api/sub-distributors
 * endpoint defaults to none, so we pass ?status=active explicitly).
 *
 * Mirrors the InvestorLookup pattern: controlled by parent via { value,
 * displayName, onSelect, onClear }.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

export function SubDistributorLookup({
  value,
  displayName,
  onSelect,
  onClear,
  placeholder = "Type sub-distributor name, code, or ARN…",
}: {
  value: string | null;
  displayName: string | null;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; name: string; code: string | null; arnNumber: string | null; city: string | null }>
  >([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch — 250ms.
  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/sub-distributors?status=active&q=${encodeURIComponent(q.trim())}`
        );
        const j = await res.json();
        setResults((j.subDistributors ?? []).slice(0, 20));
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  // Show the picked value as a chip; clear → re-enable input
  if (value && displayName && !open) {
    return (
      <div className="flex items-center gap-2">
        <div className="chip bg-violet-50 text-violet-800 border border-violet-200 inline-flex items-center gap-2">
          <span className="text-xs font-medium">{displayName}</span>
          <button
            type="button"
            onClick={() => {
              onClear();
              setQ("");
              setOpen(true);
            }}
            className="text-violet-600 hover:text-rose-600"
            title="Clear"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input-base text-sm w-full"
      />
      {open && (q.length >= 1 || results.length > 0) && (
        <div className="absolute z-30 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-72 overflow-auto">
          {busy && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" /> Searching…
            </div>
          )}
          {!busy && results.length === 0 && q.length >= 1 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No sub-distributors match. Try a different name or ARN.
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onSelect(r.id, r.name);
                setOpen(false);
                setQ("");
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b last:border-b-0"
            >
              <div className="text-sm font-medium">{r.name}</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                {r.code && <span className="font-mono">{r.code}</span>}
                {r.arnNumber && (
                  <span className="font-mono">ARN: {r.arnNumber}</span>
                )}
                {r.city && <span>· {r.city}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
