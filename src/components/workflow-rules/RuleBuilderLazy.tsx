"use client";

/**
 * Lazy boundary for the 1,200-line rule builder. Code-split so the rule editor
 * loads only when this route renders, keeping it out of the shared chunk.
 */
import dynamic from "next/dynamic";

export const RuleBuilder = dynamic(
  () => import("./RuleBuilder").then((m) => m.RuleBuilder),
  { ssr: false, loading: () => <div className="skeleton h-[60vh] min-h-[420px] w-full rounded-xl" /> }
);
