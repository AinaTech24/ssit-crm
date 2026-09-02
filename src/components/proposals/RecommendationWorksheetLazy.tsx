"use client";

/**
 * Lazy boundary for the proposal recommendation worksheet — heavy interactive
 * table, code-split so it streams in behind a skeleton instead of bloating the
 * route's first load.
 */
import dynamic from "next/dynamic";

export const RecommendationWorksheet = dynamic(
  () => import("./RecommendationWorksheet").then((m) => m.RecommendationWorksheet),
  { ssr: false, loading: () => <div className="skeleton h-[50vh] min-h-[360px] w-full rounded-xl" /> }
);
