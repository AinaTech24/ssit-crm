"use client";

/**
 * Admin grid for monthly targets. One row per person / branch / desk, one column
 * per metric, and a "Shown" switch per row that decides whether that person or
 * branch is shown their target and achievement (the admin always sees everything).
 * Leave a cell empty (or 0) for "no target"; saving removes it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

type Metric = { key: string; label: string; unit: "count" | "inr"; hint: string };
type Subject = { id: string; name: string; sub?: string };
type Row = { subjectType: "user" | "branch" | "desk"; subjectId: string; metricKey: string; targetValue: number; visible: boolean };
type Grid = {
  users: { id: string; name: string; roles: string[] }[];
  branches: { id: string; name: string; members: number }[];
  desks: { id: string; name: string; members: number }[];
  rows: Row[];
};

const ROLE_LABEL: Record<string, string> = {
  rm: "RM",
  back_office: "BO",
  ra_research: "RA",
  ra_sales: "RA",
  ria: "RIA",
  branch_head: "Branch head",
  ops: "Ops",
  marketing: "Marketing",
};

export function TargetsManager({ initialPeriod }: { initialPeriod: string }) {
  const toast = useToast();
  const [period, setPeriod] = useState(initialPeriod);
  const [kind, setKind] = useState<"user" | "branch" | "desk">("user");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [values, setValues] = useState<Record<string, string>>({}); // `${type}:${id}:${metric}` → text
  const [shown, setShown] = useState<Record<string, boolean>>({}); // `${type}:${id}` → visible
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setGrid(null);
    try {
      const r = await fetch(`/api/target-goals?period=${period}`, { cache: "no-store" });
      if (!r.ok) {
        toast.error((await readApiError(r, "load targets")).message);
        return;
      }
      const j = await r.json();
      setMetrics(j.metrics ?? []);
      setGrid(j.grid);
      const v: Record<string, string> = {};
      const s: Record<string, boolean> = {};
      for (const row of (j.grid?.rows ?? []) as Row[]) {
        v[`${row.subjectType}:${row.subjectId}:${row.metricKey}`] = String(row.targetValue);
        s[`${row.subjectType}:${row.subjectId}`] = row.visible;
      }
      setValues(v);
      setShown(s);
      setDirty(false);
    } catch (e) {
      toast.error(readThrownError(e, "load targets").message);
    }
  }, [period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const subjects: Subject[] = useMemo(() => {
    if (!grid) return [];
    if (kind === "user")
      return grid.users
        .map((u) => ({
          id: u.id,
          name: u.name,
          sub: u.roles.map((r) => ROLE_LABEL[r]).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · "),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const src = kind === "branch" ? grid.branches : grid.desks;
    return src.map((b) => ({ id: b.id, name: b.name, sub: `${b.members} people` }));
  }, [grid, kind]);

  async function save() {
    if (!grid) return;
    const out: Row[] = [];
    for (const type of ["user", "branch", "desk"] as const) {
      const list = type === "user" ? grid.users : type === "branch" ? grid.branches : grid.desks;
      for (const s of list) {
        for (const m of metrics) {
          const key = `${type}:${s.id}:${m.key}`;
          const text = (values[key] ?? "").replace(/,/g, "").trim();
          const had = grid.rows.some((r) => r.subjectType === type && r.subjectId === s.id && r.metricKey === m.key);
          if (!text && !had) continue;
          const n = text ? Number(text) : 0;
          if (!Number.isFinite(n) || n < 0) {
            toast.error(`“${text}” is not a valid target for ${s.name} · ${m.label}`);
            return;
          }
          out.push({
            subjectType: type,
            subjectId: s.id,
            metricKey: m.key,
            targetValue: n,
            visible: shown[`${type}:${s.id}`] ?? true,
          });
        }
      }
    }
    setBusy(true);
    try {
      const r = await fetch("/api/target-goals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, rows: out }),
      });
      if (!r.ok) {
        toast.error((await readApiError(r, "save targets")).message);
        return;
      }
      toast.success("Targets saved");
      await load();
    } catch (e) {
      toast.error(readThrownError(e, "save targets").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs">
            <span className="text-[11px] text-muted-foreground">Month</span>
            <input
              type="month"
              value={period}
              onChange={(e) => e.target.value && setPeriod(e.target.value)}
              className="input-base block"
            />
          </label>
          <div className="inline-flex rounded-lg border bg-secondary/30 p-1 text-xs">
            {(
              [
                ["user", "People"],
                ["branch", "Branches"],
                ["desk", "Desks"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-md px-3 py-1 font-medium ${kind === k ? "bg-brand-cyan text-white" : "text-muted-foreground hover:bg-accent"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={save} disabled={busy || !grid || !dirty} className="btn-primary text-xs inline-flex items-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin" />} Save targets
        </button>
      </div>

      {!grid ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : subjects.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing to set targets for here yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{kind === "user" ? "Person" : kind === "branch" ? "Branch" : "Desk"}</th>
                {metrics.map((m) => (
                  <th key={m.key} className="px-2 py-2 text-left" title={m.hint}>
                    {m.label}
                    <div className="text-[10px] font-normal">{m.unit === "inr" ? "₹" : "count"}</div>
                  </th>
                ))}
                <th className="px-3 py-2 text-center" title="Show this person / branch their target and achievement">
                  Shown to them
                </th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const sk = `${kind}:${s.id}`;
                return (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{s.name}</div>
                      {s.sub && <div className="text-[10px] text-muted-foreground">{s.sub}</div>}
                    </td>
                    {metrics.map((m) => {
                      const key = `${sk}:${m.key}`;
                      return (
                        <td key={m.key} className="px-2 py-1.5">
                          <input
                            inputMode="decimal"
                            value={values[key] ?? ""}
                            onChange={(e) => {
                              setValues((v) => ({ ...v, [key]: e.target.value }));
                              setDirty(true);
                            }}
                            placeholder="—"
                            className="input-base w-24 text-right tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={shown[sk] ?? true}
                        onChange={(e) => {
                          setShown((v) => ({ ...v, [sk]: e.target.checked }));
                          setDirty(true);
                        }}
                        aria-label={`Show ${s.name} their target`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Achievement is worked out from the records for the month — leads added, meetings completed, clients onboarded,
        tasks completed, business booked, new SIP amount started, and today&apos;s AUM. A branch or desk target adds up
        everyone in it. Branch heads also see the people in their own branch or desk when those are shown.
      </div>
    </div>
  );
}
