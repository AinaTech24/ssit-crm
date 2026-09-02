"use client";

/**
 * Debounced autocomplete that searches the Clients (investors) module.
 *
 * Used on forms where one record references another investor — e.g. the
 * "Referred by" picker on the New Lead form, the family-head selector, etc.
 *
 * Hits /api/search?q=… and surfaces investors only. Returns both the id and
 * the display name to the parent via onSelect.
 *
 * Usage:
 *   <InvestorLookup
 *     value={investorId}
 *     displayName={referredByName}
 *     onSelect={(id, name) => { setInvestorId(id); setName(name); }}
 *     placeholder="Start typing client name, PAN, or mobile…"
 *   />
 */

import { useEffect, useRef, useState } from "react";
import { Search, Check, X, Loader2, UserCircle2 } from "lucide-react";

type Kind = "investor" | "lead";
type Investor = {
  id: string;
  name: string;
  pan?: string | null;
  phone: string | null;
  email: string | null;
  segment_tag?: string | null;
  stage?: string | null;
  kind?: Kind;
};

export function InvestorLookup({
  value,
  displayName,
  onSelect,
  onClear,
  placeholder,
  required,
  includeLeads,
  displayKind,
}: {
  value?: string | null;
  displayName?: string | null;
  /** kind is "investor" unless includeLeads surfaced a lead match. */
  onSelect: (id: string, name: string, kind?: Kind) => void;
  onClear?: () => void;
  placeholder?: string;
  required?: boolean;
  /** Also search open Leads (not just Clients) and tag results by kind. */
  includeLeads?: boolean;
  /** Subtitle on the picked-state pill — reflects whether a lead or client was chosen. */
  displayKind?: Kind;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Investor[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside closes
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        const invs = ((j.investors ?? []) as Investor[]).map((r) => ({ ...r, kind: "investor" as const }));
        const lds = includeLeads ? ((j.leads ?? []) as Investor[]).map((r) => ({ ...r, kind: "lead" as const })) : [];
        setResults([...invs, ...lds]);
        setOpen(true);
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // When a value is already locked in, show the picked-state pill instead of the search input.
  if (value && displayName) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
          <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
            {displayName
              .split(" ")
              .map((n) => n[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{displayName}</div>
            <div className="text-[11px] text-muted-foreground">{displayKind === "lead" ? "Linked from Leads" : "Linked from Clients"}</div>
          </div>
          <Check className="size-4 text-emerald-600 flex-shrink-0" />
        </div>
        <button
          type="button"
          onClick={() => {
            setQ("");
            setResults([]);
            onClear?.();
          }}
          className="btn-icon"
          aria-label="Clear referrer"
          title="Clear"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder ?? "Search by name, PAN, mobile, or email…"}
          required={required}
          className="input-base pl-9"
        />
        {busy && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-brand-cyan animate-spin" />
        )}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-72 overflow-y-auto scrollbar-thin animate-scale-in">
          {results.length === 0 && !busy ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <UserCircle2 className="size-6 mx-auto opacity-40 mb-1" />
              No {includeLeads ? "clients or leads" : "clients"} match "{q}".
              <div className="mt-1 text-[10px]">
                Try searching by PAN, mobile, or email.
              </div>
            </div>
          ) : (
            <ul className="py-1.5">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(r.id, r.name, r.kind);
                      setQ("");
                      setResults([]);
                      setOpen(false);
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-brand-cyan-light/40 transition-colors"
                  >
                    <div className="size-7 rounded-full brand-gradient text-white grid place-items-center text-[10px] font-bold flex-shrink-0 shadow-sm">
                      {r.name
                        .split(" ")
                        .map((n) => n[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {r.name}
                        {r.kind === "lead" ? (
                          <span className="chip text-[9px] bg-amber-100 text-amber-700">Lead</span>
                        ) : r.segment_tag ? (
                          <span className="chip text-[9px] bg-brand-cyan-light text-brand-cyan-deep">
                            {r.segment_tag}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate font-mono">
                        {r.kind === "lead"
                          ? `${r.stage ? r.stage.replace(/_/g, " ") : "lead"} · ${r.phone ?? "—"}`
                          : `${r.pan ?? "—"} · ${r.phone ?? "—"}`}
                      </div>
                    </div>
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
