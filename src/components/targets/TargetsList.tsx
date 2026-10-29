import type { SubjectCard } from "@/lib/targets/view";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmt = (unit: "count" | "inr", n: number) => (unit === "inr" ? inr(n) : num(n));

/** RM view: a plain list in the same style as "My open tasks" — metric, target, what you achieved. */
export function TargetsList({ cards, userId }: { cards: SubjectCard[]; userId: string }) {
  return (
    <div className="divide-y">
      {cards.map((c) => (
        <div key={`${c.subjectType}:${c.subjectId}`} className="py-2">
          <div className="text-[11px] font-semibold text-muted-foreground">
            {c.subjectType === "user" && c.subjectId === userId ? "You" : c.name}
          </div>
          {c.metrics.map((m) => {
            const pct = m.target > 0 ? (m.actual / m.target) * 100 : 0;
            const tone = pct >= 100 ? "text-emerald-700" : pct >= 60 ? "text-amber-700" : "text-rose-700";
            return (
              <div key={m.key} className="flex items-center justify-between gap-3 border-t border-border/40 py-1.5 text-xs first:border-t-0">
                <span className="font-medium">{m.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  Target <b className="text-foreground">{fmt(m.unit, m.target)}</b> · Achieved{" "}
                  <b className="text-foreground">{fmt(m.unit, m.actual)}</b>{" "}
                  <b className={tone}>{Math.round(pct)}%</b>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
