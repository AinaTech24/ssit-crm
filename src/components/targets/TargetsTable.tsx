import { TARGET_METRICS } from "@/lib/targets";
import { DEPARTMENT_LABEL } from "@/lib/team/departments";
import type { SubjectCard } from "@/lib/targets/view";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmt = (unit: "count" | "inr", n: number) => (unit === "inr" ? inr(n) : num(n));
const KIND = { user: "Person", branch: "Branch", desk: "Desk" } as const;

/**
 * One row per person (or branch / desk), target and achievement per metric — the
 * same table style as "Meetings & portfolio reviews by RM". People are grouped
 * by department, so Advisory (RA / RIA), Sales, Operations and the rest each
 * read as their own block. What a viewer sees is decided upstream by
 * loadVisibleTargets: an RA with no team gets one row, a team lead gets the team.
 */
export function TargetsTable({ cards, you }: { cards: SubjectCard[]; you: string }) {
  const used = new Set(cards.flatMap((c) => c.metrics.map((m) => m.key)));
  const cols = TARGET_METRICS.filter((m) => used.has(m.key));

  const groupOf = (c: SubjectCard) =>
    c.subjectType === "user" ? (c.department ? (DEPARTMENT_LABEL[c.department] ?? c.department) : "No department") : "Branches & desks";
  const groups = new Map<string, SubjectCard[]>();
  for (const c of cards) (groups.get(groupOf(c)) ?? groups.set(groupOf(c), []).get(groupOf(c))!).push(c);
  // Branches & desks last, "No department" just before them, the rest alphabetical.
  const rank = (g: string) => (g === "Branches & desks" ? 2 : g === "No department" ? 1 : 0);
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([g, rows]) => [g, [...rows].sort((a, b) => a.name.localeCompare(b.name))] as const);
  const showGroups = ordered.length > 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs table-modern">
        <thead>
          <tr>
            <th className="text-left py-1.5 px-3">Name</th>
            {cols.map((m) => (
              <th key={m.key} className="text-right py-1.5 px-3">
                {m.label}
                <div className="font-normal text-[10px] normal-case">achieved / target</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map(([group, rows]) => (
            <GroupRows key={group} group={showGroups ? group : null} rows={rows} cols={cols} you={you} span={cols.length + 1} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  rows,
  cols,
  you,
  span,
}: {
  group: string | null;
  rows: SubjectCard[];
  cols: typeof TARGET_METRICS;
  you: string;
  span: number;
}) {
  return (
    <>
      {group && (
        <tr>
          <td colSpan={span} className="bg-muted/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </td>
        </tr>
      )}
      {rows.map((c) => (
        <tr key={`${c.subjectType}:${c.subjectId}`}>
          <td className="py-2 px-3">
            <span className="font-medium">{c.name}</span>
            {c.subjectType === "user" && c.subjectId === you && <span className="ml-1.5 text-[10px] text-muted-foreground">(you)</span>}
            {c.subjectType !== "user" && <span className="ml-1.5 text-[10px] text-muted-foreground">{KIND[c.subjectType]}</span>}
          </td>
          {cols.map((col) => {
            const m = c.metrics.find((x) => x.key === col.key);
            if (!m) {
              return (
                <td key={col.key} className="py-2 px-3 text-right text-muted-foreground">
                  —
                </td>
              );
            }
            const pct = m.target > 0 ? (m.actual / m.target) * 100 : 0;
            const tone = pct >= 100 ? "text-emerald-700" : pct >= 60 ? "text-amber-700" : "text-rose-700";
            return (
              <td key={col.key} className="py-2 px-3 text-right tabular-nums">
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
    </>
  );
}
