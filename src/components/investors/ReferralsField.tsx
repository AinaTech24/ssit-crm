"use client";

/**
 * Reusable multi-referral editor — used by the add-client form and the client
 * Referrals section. Each referral captures name, mobile, email, relationship
 * to the client, and a free note. Mirrors NomineesField (no document upload).
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Referral } from "@/lib/investors/referral";

export function ReferralsField({
  value,
  onChange,
}: {
  value: Referral[];
  onChange: (n: Referral[]) => void;
}) {
  function update(i: number, patch: Partial<Referral>) {
    onChange(value.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function add() {
    onChange([...value, { name: "" }]);
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No referrals added yet. Add the people this client referred.
        </p>
      )}

      {value.map((n, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2.5 bg-background/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Referral {i + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-rose-600 hover:text-rose-700 p-1"
              aria-label="Remove referral"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <NameLookup
              value={n.name ?? ""}
              onType={(v) => update(i, { name: v })}
              onPick={(p) =>
                update(i, {
                  name: p.name,
                  mobile: p.phone || n.mobile,
                  email: p.email || n.email,
                })
              }
            />
            <Inp
              label="Mobile no"
              value={n.mobile ?? ""}
              onChange={(v) => update(i, { mobile: v })}
              placeholder="+919XXXXXXXXX"
            />
            <Inp
              label="Email"
              value={n.email ?? ""}
              onChange={(v) => update(i, { email: v })}
              placeholder="name@example.com"
            />
            <Inp
              label="Relation with client"
              value={n.relation ?? ""}
              onChange={(v) => update(i, { relation: v })}
              placeholder="friend / family / colleague / …"
            />
            <label className="block sm:col-span-2">
              <div className="text-xs font-medium mb-1">Note</div>
              <textarea
                value={n.note ?? ""}
                onChange={(e) => update(i, { note: e.target.value })}
                rows={2}
                placeholder="Context, interest, or status of this referral"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm bg-background"
              />
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
      >
        <Plus className="size-3.5" /> Add referral
      </button>
    </div>
  );
}

function Inp({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded-md px-2.5 py-1.5 text-sm bg-background"
      />
    </label>
  );
}

type Match = { id: string; name: string; phone?: string | null; email?: string | null; kind: "Client" | "Lead" };

/** Name box that suggests existing clients and leads as you type and fills mobile + email from the pick. */
function NameLookup({
  value,
  onType,
  onPick,
}: {
  value: string;
  onType: (v: string) => void;
  onPick: (m: Match) => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function type(v: string) {
    onType(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setMatches([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        const r = await fetch(`/api/search?limit=15&q=${encodeURIComponent(v.trim())}`);
        if (!r.ok || mine !== seq.current) return;
        const j = await r.json();
        const found: Match[] = [
          ...((j.investors ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, phone: x.phone, email: x.email, kind: "Client" as const })),
          ...((j.leads ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, phone: x.phone, email: x.email, kind: "Lead" as const })),
        ];
        setMatches(found);
        setOpen(found.length > 0);
      } catch {
        /* suggestions are a convenience; typing a name by hand still works */
      }
    }, 250);
  }

  return (
    <label className="block relative">
      <div className="text-xs font-medium mb-1">Name</div>
      <input
        type="text"
        value={value}
        onChange={(e) => type(e.target.value)}
        onFocus={() => matches.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type a name — existing clients and leads are suggested"
        autoComplete="off"
        className="w-full border rounded-md px-2.5 py-1.5 text-sm bg-background"
      />
      {open && (
        <div className="absolute z-20 left-0 mt-1 max-h-72 w-[24rem] max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border bg-card shadow-lg">
          {matches.map((m) => (
            <button
              key={`${m.kind}-${m.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(m);
                setOpen(false);
                setMatches([]);
              }}
              className="w-full text-left px-3 py-2 hover:bg-secondary text-sm border-b last:border-b-0"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium break-words">{m.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{m.kind}</span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {[m.phone, m.email].filter(Boolean).join(" · ") || "No contact details saved"}
              </div>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
