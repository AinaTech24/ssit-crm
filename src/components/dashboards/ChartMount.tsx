"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Mount-gate for Recharts <ResponsiveContainer>.
 *
 * During SSR (and the first client paint, before the browser has run
 * layout) a ResponsiveContainer measures its parent as 0×0 and logs:
 *
 *   "The width(-1) and height(-1) of chart should be greater than 0,
 *    please check the style of container, or the props width(100%) and
 *    height(100%)."
 *
 * The chart itself renders fine once a real size is measured — the warning
 * is pure console noise. Rendering the chart only after mount, when the
 * fixed-height parent has a measurable box, silences it with zero visual
 * change. The wrapper keeps the sizing/positioning classes so absolutely
 * positioned overlays (e.g. the donut centre label) still anchor correctly.
 */
export function ChartMount({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <div className={className}>{mounted ? children : null}</div>;
}
