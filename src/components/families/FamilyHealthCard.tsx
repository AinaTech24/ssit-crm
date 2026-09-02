import Link from "next/link";
import { Activity, CheckCircle2, ArrowRight } from "lucide-react";
import {
  familyHealth,
  familyMissingChecklist,
  type FamilyForHealth,
  type MemberForHealth,
} from "@/lib/families/health";
import { healthBandClasses } from "@/lib/investors/health";

/**
 * Family Health Card — composite score + breakdown + actionable
 * "what's missing" punch-list. Pure render component.
 */
export function FamilyHealthCard({
  family,
  members,
  familyId,
}: {
  family: FamilyForHealth;
  members: MemberForHealth[];
  familyId: string;
}) {
  const health = familyHealth(family, members);
  const checklist = familyMissingChecklist(familyId, family, members);
  const cls = healthBandClasses(health.band);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-emerald-50 grid place-items-center">
            <Activity className="size-3.5 text-emerald-700" />
          </div>
          Family health
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border ${cls.chip} font-semibold`}
        >
          <span className={`size-2 rounded-full ${cls.dot}`} />
          {cls.label}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Score gauge */}
        <div className="flex items-center gap-4">
          <div className="relative size-24 flex-shrink-0">
            <svg className="size-full transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                className="stroke-slate-100 fill-none"
                strokeWidth="8"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                className={`fill-none ${
                  health.band === "green"
                    ? "stroke-emerald-500"
                    : health.band === "amber"
                    ? "stroke-amber-500"
                    : "stroke-rose-500"
                }`}
                strokeWidth="8"
                strokeDasharray={`${2 * Math.PI * 40}`}
                strokeDashoffset={`${2 * Math.PI * 40 * (1 - health.score / 100)}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-2xl font-bold tabular-nums">{health.score}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  / 100
                </div>
              </div>
            </div>
          </div>
          <div className="text-xs space-y-1">
            <div className="font-semibold text-foreground/90">
              {health.activeMemberCount} active member
              {health.activeMemberCount === 1 ? "" : "s"}
            </div>
            <div className="text-muted-foreground">
              {health.hasNextGen ? "Next-gen captured ✓" : "No next-gen captured"}
            </div>
          </div>
        </div>

        {/* Coverage bars */}
        <div className="space-y-2.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Coverage
          </div>
          <CoverageBar label="Nominee" pct={health.coverage.nomineePct} />
          <CoverageBar label="KYC verified" pct={health.coverage.kycPct} />
          <CoverageBar label="Risk profile" pct={health.coverage.riskProfilePct} />
        </div>

        {/* Why-this-score */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Why this score
          </div>
          {health.factors.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" />
              <span className="font-medium">All checks green.</span>
            </div>
          ) : (
            <ul className="space-y-1 text-xs">
              {health.factors.slice(0, 4).map((f) => (
                <li
                  key={f.key}
                  className="flex items-start justify-between gap-2 py-0.5"
                >
                  <span className="font-medium truncate">{f.label}</span>
                  <span className="text-rose-700 font-bold tabular-nums flex-shrink-0">
                    −{f.deduction}
                  </span>
                </li>
              ))}
              {health.factors.length > 4 && (
                <li className="text-[10px] text-muted-foreground italic">
                  + {health.factors.length - 4} more
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Missing-data punch-list */}
      {checklist.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Fix-it checklist · {checklist.length} item{checklist.length === 1 ? "" : "s"}
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {checklist.slice(0, 8).map((c) => (
              <li
                key={c.key}
                className={`text-xs px-2.5 py-1.5 rounded-md border flex items-center justify-between gap-2 ${
                  c.severity === "high"
                    ? "bg-rose-50/40 border-rose-100 text-rose-800"
                    : "bg-amber-50/40 border-amber-100 text-amber-800"
                }`}
              >
                <span className="truncate">{c.label}</span>
                {c.action && (
                  <Link
                    href={c.action.href}
                    className="inline-flex items-center gap-0.5 font-semibold whitespace-nowrap hover:underline"
                  >
                    {c.action.label}
                    <ArrowRight className="size-3" />
                  </Link>
                )}
              </li>
            ))}
            {checklist.length > 8 && (
              <li className="text-[10px] text-muted-foreground italic px-2.5 py-1.5">
                + {checklist.length - 8} more — scroll the member list to address.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function CoverageBar({ label, pct }: { label: string; pct: number }) {
  const tone = pct >= 100 ? "emerald" : pct >= 60 ? "amber" : "rose";
  const bg =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
      ? "bg-amber-500"
      : "bg-rose-500";
  const text =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-rose-700";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className={`tabular-nums font-bold ${text}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
