"use client";

/**
 * Per-person KRA target editor — a members × metrics grid of annual targets.
 * Each cell auto-saves on blur to /api/team/targets.
 */

import { useState } from "react";
import { Loader2, Check } from "lucide-react";

type Member = { id: string; name: string };
type Metric = { key: string; label: string; unit: "inr" | "count" | "pct" };

export function TargetGrid({
  members,
  metrics,
  initial,
  fiscalYear,
}: {
  members: Member[];
  metrics: Metric[];
  initial: Record<string, number>;
  fiscalYear: string;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const m of members) for (const k of metrics) {
      const cell = `${m.id}:${k.key}`;
      o[cell] = initial[cell] != null ? String(initial[cell]) : "";
    }
    return o;
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(userId: string, metricKey: string, raw: string) {
    const cell = `${userId}:${metricKey}`;
    const annualTarget = Number(raw.replace(/,/g, "")) || 0;
    setSaving(cell);
    try {
      const r = await fetch("/api/team/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, metricKey, annualTarget, fiscalYear }),
      });
      if (r.ok) {
        setSaved(cell);
        setTimeout(() => setSaved((s) => (s === cell ? null : s)), 1500);
      }
    } finally {
      setSaving((s) => (s === cell ? null : s));
    }
  }

  if (members.length === 0) {
    return <div className="card-surface p-6 text-sm text-muted-foreground text-center">No members for this team.</div>;
  }

  return (
    <div className="card-surface overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left font-medium px-3 py-2">Member</th>
            {metrics.map((m) => (
              <th key={m.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">
                {m.label}
                {m.unit === "inr" && " (₹)"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {members.map((mem) => (
            <tr key={mem.id}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{mem.name}</td>
              {metrics.map((k) => {
                const cell = `${mem.id}:${k.key}`;
                return (
                  <td key={k.key} className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <input
                        inputMode="numeric"
                        value={vals[cell] ?? ""}
                        onChange={(e) => setVals((v) => ({ ...v, [cell]: e.target.value }))}
                        onBlur={(e) => save(mem.id, k.key, e.target.value)}
                        placeholder="—"
                        className="input-base h-8 text-xs w-28 text-right bg-white"
                        aria-label={`${mem.name} ${k.label} annual target`}
                      />
                      {saving === cell ? (
                        <Loader2 className="size-3 animate-spin text-brand-cyan" />
                      ) : saved === cell ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <span className="size-3" />
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
