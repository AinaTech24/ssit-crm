"use client";

/**
 * Reusable multi-referral editor — used by the add-client form and the client
 * Referrals section. Each referral captures name, mobile, email, relationship
 * to the client, and a free note. Mirrors NomineesField (no document upload).
 */

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
            <Inp label="Name" value={n.name ?? ""} onChange={(v) => update(i, { name: v })} />
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
