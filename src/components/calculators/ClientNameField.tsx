"use client";

/**
 * Client-name field for the calculators — a free-text input that also offers
 * live client suggestions from the Clients module. Type any name (e.g. a
 * prospect) OR pick an existing client from the dropdown; the chosen/typed name
 * is what the calculator prints. Searches /api/search?q=… (debounced).
 */

import { useEffect, useRef, useState } from "react";

type Hit = { id: string; name: string; pan?: string | null; phone?: string | null };

export function ClientNameField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [results, setResults] = useState<Hit[]>([]);
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
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const j = await r.json();
        setResults(((j.investors ?? []) as Hit[]).slice(0, 8));
      } catch {
        setResults([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder ?? "Type a name or pick a client…"}
        className={className ?? "input-base text-sm w-full"}
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-64 overflow-y-auto scrollbar-thin">
          <ul className="py-1">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(r.name);
                    setResults([]);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-primary/10 transition-colors"
                >
                  <span className="font-medium text-sm">{r.name}</span>
                  <span className="text-[11px] text-muted-foreground ml-2 font-mono">
                    {r.pan ?? "—"} · {r.phone ?? "—"}
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
