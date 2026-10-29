import { TARGET_METRICS } from "@/lib/targets";
import type { SubjectCard } from "@/lib/targets/view";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmt = (unit: "count" | "inr", n: number) => (unit === "inr" ? inr(n) : num(n));
const KIND = { user: "Person", branch: "Branch", desk: "Desk" } as const;

/** Admin / branch-head view: one row per RM (or branch / desk), target and achievement per metric. */
export function TargetsTable({ cards }: { cards: SubjectCard[] }) {
  const used = new Set(cards.flatMap((c) => c.metrics.map((m) => m.key)));
  const cols = TARGET_METRICS.filter((m) => used.has(m.key));
  const rows = [...cards].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">RM / team</th>
            {cols.map((m) => (
              <th key={m.key} className="px-3 py-2 text-right">
                {m.label}
                <div className="font-normal text-[10px]">achieved / target</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.subjectType}:${c.subjectId}`} className="border-t align-top">
              <td className="px-3 py-2">
                <div className="font-medium">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">{KIND[c.subjectType]}</div>
              </td>
              {cols.map((col) => {
                const m = c.metrics.find((x) => x.key === col.key);
                if (!m) {
                  return (
                    <td key={col.key} className="px-3 py-2 text-right text-muted-foreground">
                      —
                    </td>
                  );
                }
                const pct = m.target > 0 ? (m.actual / m.target) * 100 : 0;
                const tone = pct >= 100 ? "text-emerald-700" : pct >= 60 ? "text-amber-700" : "text-rose-700";
                return (
                  <td key={col.key} className="px-3 py-2 text-right tabular-nums">
                    <div>
                      <span className="font-semibold">{fmt(m.unit, m.actual)}</span>
                      <span className="text-muted-foreground"> / {fmt(m.unit, m.target)}</span>
                    </div>
                    <div className={`text-[10px] font-semibold ${tone}`}>{Math.round(pct)}%</div>
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
