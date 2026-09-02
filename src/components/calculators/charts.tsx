"use client";

/**
 * Tiny presentational charts for the investor-facing conversion calculators.
 * Pure SVG / divs, theme-aware via CSS vars. No data fetching, no domain math.
 */

/** Compact INR — ₹X.XX Cr / ₹X.X L / ₹Xk. For chart axes & punchlines. */
export function inrShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}

export function LinesChart({
  xLabels,
  lines,
  fmtY,
  height = 200,
  ariaLabel = "chart",
}: {
  xLabels: (string | number)[];
  lines: { label: string; color: string; values: number[] }[];
  fmtY?: (n: number) => string;
  height?: number;
  ariaLabel?: string;
}) {
  const W = 640;
  const H = height;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 22;
  const n = Math.max(0, ...lines.map((l) => l.values.length));
  if (n < 2) return null;
  const maxV = Math.max(1, ...lines.flatMap((l) => l.values));
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.max(0, v) / maxV) * (H - padT - padB);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const fY = fmtY ?? ((v: number) => String(Math.round(v)));
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-4 mb-2 text-[11px] flex-wrap">
        {lines.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: l.color }} /> {l.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(maxV * g)}
              y2={y(maxV * g)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
            <text x={padL} y={y(maxV * g) - 2} className="fill-muted-foreground" fontSize={9}>
              {fY(maxV * g)}
            </text>
          </g>
        ))}
        {lines.map((l, li) => (
          <polyline
            key={li}
            fill="none"
            stroke={l.color}
            strokeWidth={2.5}
            points={l.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
          />
        ))}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 5}
            textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            fontSize={9}
          >
            {xLabels[t] ?? ""}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** Horizontal bars — width proportional to `value`; `display` overrides in-bar text. */
export function BarsChart({
  bars,
  fmtV,
  accent = "#0891b2",
}: {
  bars: { label: string; value: number; display?: string; caption?: string; color?: string }[];
  fmtV?: (n: number) => string;
  accent?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const fV = fmtV ?? ((v: number) => String(Math.round(v)));
  return (
    <div className="space-y-2">
      {bars.map((b, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-28 shrink-0 text-right font-medium truncate">{b.label}</div>
          <div className="flex-1 bg-secondary/40 rounded h-6 relative overflow-hidden">
            <div
              className="h-full rounded flex items-center justify-end px-2 text-[10px] font-semibold text-white whitespace-nowrap"
              style={{ width: `${Math.max(8, (b.value / max) * 100)}%`, background: b.color ?? accent }}
            >
              {b.display ?? fV(b.value)}
            </div>
          </div>
          {b.caption && <div className="w-20 shrink-0 text-[10px] text-muted-foreground">{b.caption}</div>}
        </div>
      ))}
    </div>
  );
}
