"use client";

/**
 * Branch + RM-wise business report ("Anand DK SIP", "… Equity Lumpsum",
 * "… Liquid Lumpsum", "… Insurance"). Pick a branch + month → each branch RM is a
 * row with the kind's columns (computed live from Business Entries / Insurance),
 * plus an "Outside to our" residual and a TOTAL. Read-only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { useToast } from "@/components/ui/Toast";
import { RM_MATRIX, type RmMatrixKey } from "@/lib/business/rm-matrix-config";
import type { RmMatrix, MatrixRow } from "@/lib/business/rm-matrix";

const fmt = (n: number): string =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function defaultPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function recentMonths(count = 24): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function BranchRmMatrix({ kind }: { kind: RmMatrixKey }) {
  const meta = RM_MATRIX[kind];
  const toast = useToast();
  const months = useMemo(() => recentMonths(), []);
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [branchId, setBranchId] = useState<string>("");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [matrix, setMatrix] = useState<RmMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: string, b: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ kind, period: p });
        if (b) qs.set("branch", b);
        const res = await fetch(`/api/reports/branch-rm?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const data = await res.json();
        setBranches(data.branches ?? []);
        setMatrix(data.matrix ?? null);
        if (data.matrix?.branchId) setBranchId(data.matrix.branchId);
      } catch {
        toast.error("Could not load this report.", "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [kind, toast]
  );

  useEffect(() => {
    load(period, branchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchId, kind]);

  const net = (v: number[]): number => (v[0] ?? 0) - (v[1] ?? 0);

  const renderValueCells = (row: MatrixRow) => (
    <>
      {meta.columns.map((c, i) => (
        <Td key={c.key} className="text-right tabular-nums">
          {fmt(row.values[i] ?? 0)}
        </Td>
      ))}
      {meta.hasNet && (
        <Td className={`text-right tabular-nums ${net(row.values) < 0 ? "text-rose-600" : ""}`}>
          {fmt(net(row.values))}
        </Td>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Branch</span>
          <SelectField className="w-52" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Month</span>
          <SelectField className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </label>
        <div className="flex-1" />
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="size-4" /> Print
        </button>
      </div>

      <div className="text-center hidden print:block">
        <h2 className="text-lg font-bold">
          {matrix?.title ?? meta.title} — As On {matrix?.asOnLabel ?? ""}
        </h2>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Loading…</div>
      ) : !matrix ? (
        <div className="text-sm text-muted-foreground py-10 text-center">No branches found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-cyan-light/40 text-left">
                <Th className="w-12 text-center">Sr.</Th>
                <Th>Name</Th>
                {meta.columns.map((c) => (
                  <Th key={c.key} className="text-right">
                    {c.label}
                  </Th>
                ))}
                {meta.hasNet && <Th className="text-right">Net</Th>}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r, i) => (
                <tr key={r.rmId ?? i} className="border-t border-border">
                  <Td className="text-center text-muted-foreground">{i + 1}</Td>
                  <Td className="font-medium">{r.name}</Td>
                  {renderValueCells(r)}
                </tr>
              ))}

              <tr className="border-t border-border bg-amber-50/30">
                <Td className="text-center text-muted-foreground">{matrix.rows.length + 1}</Td>
                <Td>{matrix.outside.name}</Td>
                {renderValueCells(matrix.outside)}
              </tr>

              <tr className="border-t-2 border-border bg-brand-cyan-light/60 font-semibold">
                <Td />
                <Td>{matrix.total.name}</Td>
                {renderValueCells(matrix.total)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Computed live from {meta.source === "insurance" ? "the Insurance module (annual premium)" : "Business Entries"}.
        Each RM in the branch is a row; “Outside to our” is the branch business not booked by a branch RM.
        {kind === "sip" && " SIP Stop is captured via the “SIP Stop” transaction type on a business entry."}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold text-xs uppercase tracking-wide ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-1.5 ${className}`}>{children}</td>;
}
