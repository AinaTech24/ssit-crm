"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Users, Sparkles, FileText, Repeat, LifeBuoy, FolderArchive, Loader2, X } from "lucide-react";

type Results = {
  investors?: any[];
  leads?: any[];
  folios?: any[];
  sips?: any[];
  serviceRequests?: any[];
  documents?: any[];
};

/**
 * Inline global search. The input lives in the header; results drop into a
 * popover anchored directly beneath it — no full-screen overlay, so the header
 * is never blurred and the bar never jumps. Esc closes. (Ctrl/⌘-K now opens the
 * global CommandPalette instead — see components/layout/CommandPalette.tsx.)
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>({});
  const [busy, setBusy] = useState(false);
  // Guard: readOnly until first focus defeats Chrome autofilling a saved email
  // into the search box (Chrome ignores autoComplete="off" on its own).
  const [roGuard, setRoGuard] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Esc closes + blurs. (Ctrl/⌘-K is owned by the global CommandPalette now —
  // binding it here too would open both at once.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside the search widget.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({});
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await res.json();
        setResults(j);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const total =
    (results.investors?.length ?? 0) +
    (results.leads?.length ?? 0) +
    (results.folios?.length ?? 0) +
    (results.sips?.length ?? 0) +
    (results.serviceRequests?.length ?? 0) +
    (results.documents?.length ?? 0);

  const close = () => setOpen(false);
  const showPanel = open && q.trim().length >= 1;

  return (
    <div ref={wrapRef} className="relative min-w-0 max-w-md flex-1">
      {/* Input shell — styled like a search field, focus-within highlights it */}
      <div
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm
                   transition-colors duration-150 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"
      >
        <Search className="size-3.5 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="search"
          name="global-search-q"
          readOnly={roGuard}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (roGuard) setRoGuard(false);
            setOpen(true);
          }}
          placeholder="Search clients, leads, folios…"
          className="flex-1 min-w-0 bg-transparent text-sm outline-none focus:ring-0 focus-visible:ring-0 focus:shadow-none placeholder:text-muted-foreground"
          aria-label="Global search"
        />
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-brand-cyan shrink-0" />
        ) : q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* Results popover — anchored directly under the input */}
      {showPanel && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 origin-top animate-scale-in">
          <div className="card-elevated max-h-[min(70vh,30rem)] overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-2 text-sm scrollbar-thin">
              {q.trim().length < 2 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Type at least 2 characters. Try a name, PAN, mobile, folio number, or ticket #.
                </div>
              ) : total === 0 && !busy ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No results for &ldquo;{q}&rdquo;.</div>
              ) : (
                <div className="space-y-3">
                  <Group icon={Users} label="Clients" items={results.investors ?? []} onPick={close}
                    href={(r) => `/dashboard/investors/${r.id}`}
                    primary={(r) => r.name}
                    secondary={(r) => `${r.pan ?? "—"} · ${r.segment_tag ?? "—"}`}
                  />
                  <Group icon={Sparkles} label="Leads" items={results.leads ?? []} onPick={close}
                    href={(r) => `/dashboard/leads/${r.id}`}
                    primary={(r) => r.name}
                    secondary={(r) => `${r.stage} · ${r.source}`}
                  />
                  <Group icon={FileText} label="Folios" items={results.folios ?? []} onPick={close}
                    href={(r) => r.investor_id ? `/dashboard/investors/${r.investor_id}` : `/dashboard/investors`}
                    primary={(r) => `${r.folio_number}`}
                    secondary={(r) => `${r.amc_name} · ${r.investor_name ?? "—"}`}
                  />
                  <Group icon={Repeat} label="SIPs" items={results.sips ?? []} onPick={close}
                    href={() => `/dashboard/sips`}
                    primary={(r) => r.scheme_name}
                    secondary={(r) => `₹${r.amount}/mo · ${r.investor_name ?? "—"} · ${r.status}`}
                  />
                  <Group icon={LifeBuoy} label="Service requests" items={results.serviceRequests ?? []} onPick={close}
                    href={() => `/dashboard/service-requests`}
                    primary={(r) => r.subject}
                    secondary={(r) => `${r.ticket_no} · ${r.investor_name ?? "—"} · ${r.status}`}
                  />
                  <Group icon={FolderArchive} label="Documents" items={results.documents ?? []} onPick={close}
                    href={() => `/dashboard/documents`}
                    primary={(r) => r.name}
                    secondary={(r) => r.category}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  icon: Icon,
  label,
  items,
  href,
  primary,
  secondary,
  onPick,
}: {
  icon: any;
  label: string;
  items: any[];
  href: (r: any) => string;
  primary: (r: any) => string;
  secondary: (r: any) => string;
  onPick: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold text-muted-foreground/80 flex items-center gap-1.5">
        <Icon className="size-3 text-brand-cyan" /> {label}
        <span className="ml-auto text-muted-foreground/50 normal-case font-medium">{items.length}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((r) => (
          <li key={r.id}>
            <Link
              href={href(r)}
              onClick={onPick}
              className="block px-2.5 py-2 rounded-lg hover:bg-brand-cyan-light/40 hover:translate-x-0.5 transition-all duration-100"
            >
              <div className="font-medium text-sm">{primary(r)}</div>
              <div className="text-xs text-muted-foreground">{secondary(r)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
