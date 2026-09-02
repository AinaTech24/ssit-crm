"use client";

/**
 * SchemeAutocomplete — typeahead over the shared MF scheme catalog
 * (GET /api/mf/schemes, synced daily from mfapi.in). Use this wherever a scheme
 * (and its AMC / NAV) needs to be picked instead of free-typing a name.
 *
 *   <SchemeAutocomplete onSelect={(s) => { setScheme(s.schemeName); setAmc(s.amc); }} />
 */

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check } from "lucide-react";

export type SchemeRisk = { band: number; label: string; tone: string };
export type SchemePick = {
  schemeCode: string;
  schemeName: string;
  amc: string | null;
  category: string | null;
  nav: number | null;
  navDate: string | null;
  /** SEBI riskometer band, derived from the scheme category (best-effort). */
  risk?: SchemeRisk | null;
};

export function SchemeAutocomplete({
  onSelect,
  onQueryChange,
  defaultValue = "",
  placeholder = "Search mutual fund schemes…",
  className = "",
  size = "md",
}: {
  onSelect: (s: SchemePick) => void;
  /** Fires on free typing — lets callers keep a free-text scheme name (PMS/AIF). */
  onQueryChange?: (q: string) => void;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [q, setQ] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SchemePick[]>([]);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setBusy(false); // clear a leftover spinner when the query is cleared back under 2 chars
      return;
    }
    const id = ++reqId.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mf/schemes?q=${encodeURIComponent(query)}&limit=20`);
        const j = await res.json().catch(() => ({}));
        if (id === reqId.current) {
          setResults(Array.isArray(j.schemes) ? j.schemes : []);
          setActive(-1);
        }
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function pick(s: SchemePick) {
    onSelect(s);
    setQ(s.schemeName);
    setOpen(false);
  }

  const sizes = size === "sm" ? "h-8 text-xs pl-8 pr-2.5" : "h-9 text-sm pl-9 pr-3";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="relative">
        <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${size === "sm" ? "size-3.5" : "size-4"} text-muted-foreground`} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); onQueryChange?.(e.target.value); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && active >= 0 && results[active]) { e.preventDefault(); pick(results[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-border bg-card font-medium ${sizes} focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15`}
        />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-brand-cyan" />}
      </div>

      {open && q.trim().length >= 2 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto scrollbar-thin card-elevated bg-card p-1 animate-scale-in">
          {results.length === 0 && !busy && (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">No schemes match “{q.trim()}”.</li>
          )}
          {results.map((s, i) => (
            <li key={s.schemeCode}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={`w-full text-left rounded-md px-2.5 py-1.5 transition ${i === active ? "bg-brand-cyan-light/60" : "hover:bg-secondary"}`}
              >
                <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Check className="size-3 text-brand-cyan shrink-0 opacity-0" />
                  <span className="truncate">{s.schemeName}</span>
                  {s.risk && (
                    <span className={`shrink-0 chip text-[9px] leading-none px-1.5 py-0.5 border ${s.risk.tone}`} title={`Risk: ${s.risk.label}`}>
                      {s.risk.label}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground pl-[1.125rem] flex items-center gap-2">
                  {s.amc && <span className="truncate">{s.amc}</span>}
                  {s.category && <span className="truncate">· {s.category}</span>}
                  {s.nav != null && <span className="tabular-nums shrink-0">· NAV ₹{s.nav.toFixed(2)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
