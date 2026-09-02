import { ClipboardCheck, ArrowRight, CheckCircle2 } from "lucide-react";

/**
 * Profile Completeness Card — how much of the investor master is filled.
 *
 * Pure render (server component). The caller computes the score, filled/total
 * counts, and the list of still-missing fields; this just draws the donut and
 * the missing-field chips.
 */
export function CompletenessCard({
  completeness,
  editHref,
}: {
  completeness: {
    score: number; // 0-100
    filled: number;
    total: number;
    missing: Array<{ key: string; label: string }>;
  };
  editHref?: string;
}) {
  const score = Math.max(0, Math.min(100, Math.round(completeness.score)));
  const { filled, total, missing } = completeness;

  // Band → colours for the ring + centred score.
  const band = score >= 90 ? "emerald" : score >= 70 ? "amber" : "rose";
  const ring =
    band === "emerald"
      ? "stroke-emerald-500"
      : band === "amber"
      ? "stroke-amber-500"
      : "stroke-rose-500";
  const scoreText =
    band === "emerald"
      ? "text-emerald-600"
      : band === "amber"
      ? "text-amber-600"
      : "text-rose-600";

  // Self-contained donut geometry.
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * (1 - score / 100);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-primary/10 grid place-items-center">
            <ClipboardCheck className="size-3.5 text-primary" />
          </div>
          Profile completeness
        </h3>
        {editHref && (
          <a
            href={editHref}
            className="text-[11px] font-medium text-primary inline-flex items-center gap-1 hover:underline"
          >
            Complete profile
            <ArrowRight className="size-3" />
          </a>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Donut ring */}
        <div className="relative size-16 flex-shrink-0">
          <svg
            viewBox="0 0 64 64"
            className="size-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="32"
              cy="32"
              r={r}
              className="stroke-muted fill-none"
              strokeWidth="6"
            />
            <circle
              cx="32"
              cy="32"
              r={r}
              className={`fill-none ${ring}`}
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={dashoffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className={`text-base font-bold tabular-nums ${scoreText}`}>
              {score}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium tabular-nums">
            {filled} of {total} fields
          </div>
          <div className="text-xs text-muted-foreground">captured</div>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="mt-4 pt-4 border-t">
          <div className="text-xs text-muted-foreground mb-2">Still missing</div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <span
                key={m.key}
                className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${
                  band === "rose"
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 pt-4 border-t flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="size-4" />
          <span className="font-medium">All key fields captured</span>
        </div>
      )}
    </div>
  );
}
