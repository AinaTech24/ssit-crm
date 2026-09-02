"use client";

/**
 * Command Center — "filter by client" picker.
 *
 * Clients number in the thousands, so this is a server-backed typeahead
 * (debounced /api/search) rather than a giant <select>. Picking a client writes
 * `?client=<id>` to the URL; the SSR'd page scopes every queue group to that
 * client. When a client is active we show a removable chip instead of the input.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X, User } from "lucide-react";

type Hit = { id: string; name: string; pan?: string | null; phone?: string | null };

export function CommandClientPicker({
  selectedId,
  selectedName,
}: {
  selectedId: string;
  selectedName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setHits(((j.investors ?? []) as Hit[]).slice(0, 8));
      } catch {
        setHits([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  function setClient(id: string) {
    const params = new URLSearchParams(sp.toString());
    if (id) params.set("client", id);
    else params.delete("client");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
    setQ("");
  }

  if (selectedId) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-2.5 h-8 text-xs font-medium text-brand-cyan-deep">
        <User className="size-3" />
        <span className="max-w-[12rem] truncate">{selectedName || "Selected client"}</span>
        <button onClick={() => setClient("")} aria-label="Clear client filter" className="hover:text-rose-600">
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder="Filter by client…"
          className="input-base h-8 text-xs pl-8 w-[12rem]"
        />
      </div>
      {open && hits.length > 0 && (
        <div className="absolute left-0 mt-1 z-50 card-elevated bg-card min-w-[16rem] max-h-64 overflow-y-auto scrollbar-thin">
          <ul className="py-1">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setClient(h.id)}
                  className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan-light/40 transition-colors"
                >
                  <span className="font-medium text-sm">{h.name}</span>
                  <span className="text-[11px] text-muted-foreground ml-2 font-mono">
                    {h.pan ?? "—"} · {h.phone ?? "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
