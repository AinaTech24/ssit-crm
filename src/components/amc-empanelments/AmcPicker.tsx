"use client";

/**
 * Searchable AMC picker with "add this AMC" for a house that is not listed.
 *
 * The firm's AMC list is ~70 houses, so a plain dropdown means scrolling to find
 * one. Type to filter; if what was typed is not there, offer to add it to the
 * catalogue right here rather than sending the user off to do it elsewhere.
 *
 * Options are the tenant's amc_master rows merged with the standard list;
 * a name present in both collapses to the amc_master row so its code is kept.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { Check, ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { STANDARD_AMC_NAMES, amcCodeFromName, normaliseAmcName } from "@/lib/amc/standard-list";

type Amc = { code: string; name: string };

export function AmcPicker({
  catalog,
  value,
  onPick,
}: {
  catalog: Amc[];
  /** Selected AMC code, "" when none. */
  value: string;
  onPick: (amc: Amc) => void;
}) {
  const [extra, setExtra] = useState<Amc[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const byKey = new Map<string, Amc>();
    for (const a of [...catalog, ...extra]) byKey.set(normaliseAmcName(a.name), a);
    for (const n of STANDARD_AMC_NAMES) {
      const k = normaliseAmcName(n);
      if (!byKey.has(k)) byKey.set(k, { code: amcCodeFromName(n), name: n });
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, extra]);

  const selected = options.find((o) => o.code === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) : options;
  const exact = q ? options.some((o) => normaliseAmcName(o.name) === normaliseAmcName(query)) : true;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(a: Amc) {
    onPick(a);
    setOpen(false);
    setQuery("");
  }

  async function addNew() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/amc-empanelments/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Could not add (${res.status})`);
        return;
      }
      const amc = j.amc as Amc;
      setExtra((p) => [...p, amc]);
      choose(amc);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input-base text-sm w-full flex items-center justify-between text-left"
      >
        <span className={selected ? "" : "text-muted-foreground"}>{selected?.name ?? "Select an AMC…"}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) choose(filtered[0]);
                  else if (!exact && q) void addNew();
                }
              }}
              placeholder="Search AMCs…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  onClick={() => choose(o)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-secondary/50"
                >
                  <span>{o.name}</span>
                  {o.code === value && <Check className="size-3.5 text-emerald-600" />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No AMC matches “{query}”.</li>}
          </ul>
          {!exact && q && (
            <div className="border-t p-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void addNew()}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm font-medium text-primary hover:bg-secondary/50 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Add “{query.trim()}” as a new AMC
              </button>
              {err && <div className="px-2.5 pb-1 text-[11px] text-rose-600">{err}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
