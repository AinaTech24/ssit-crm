/**
 * Sparkline — a tiny inline trend line for KPI cards. Pure SVG, server-safe
 * (no "use client"), no dependencies. Pass a series of numbers; it scales to
 * fit. Renders nothing for <2 points so callers can drop it in unconditionally.
 */

export function Sparkline({
  data,
  width = 88,
  height = 26,
  className = "",
  strokeClass = "text-brand-cyan",
  showArea = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Tailwind text-* class — the line uses currentColor. */
  strokeClass?: string;
  showArea?: boolean;
}) {
  const series = (data ?? []).filter((n) => typeof n === "number" && !isNaN(n));
  if (series.length < 2) return null;

  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const pad = 1.5;
  const innerH = height - pad * 2;
  const stepX = width / (series.length - 1);

  const pts = series.map((d, i) => {
    const x = i * stepX;
    const y = pad + (innerH - ((d - min) / range) * innerH);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`${strokeClass} ${className}`}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {showArea && <path d={areaPath} fill="currentColor" opacity={0.12} stroke="none" />}
      <path d={linePath} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
