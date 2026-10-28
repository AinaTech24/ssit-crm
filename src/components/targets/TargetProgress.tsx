import type { SubjectCard } from "@/lib/targets/view";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmt = (unit: "count" | "inr", n: number) => (unit === "inr" ? inr(n) : num(n));

/** "This is the target and you achieved this" — one card per person / branch / desk. */
export function TargetProgress({ card, you }: { card: SubjectCard; you?: boolean }) {
  const kind = card.subjectType === "user" ? (you ? "You" : "Person") : card.subjectType === "branch" ? "Branch" : "Desk";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-semibold">{you ? "Your targets" : card.name}</div>
        <span className="chip bg-secondary text-[10px] text-muted-foreground">{kind}</span>
      </div>
      <div className="space-y-3">
        {card.metrics.map((m) => {
          const pct = m.target > 0 ? (m.actual / m.target) * 100 : 0;
          const tone = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
          return (
            <div key={m.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{m.label}</span>
                <span className="tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Target <span className="font-medium text-foreground tabular-nums">{fmt(m.unit, m.target)}</span> · Achieved{" "}
                <span className="font-medium text-foreground tabular-nums">{fmt(m.unit, m.actual)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
