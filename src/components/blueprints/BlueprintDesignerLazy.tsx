"use client";

/**
 * Lazy boundary for the blueprint (stage-flow) designer — heavy, route-specific
 * editor, deferred so it doesn't ship in the route's initial JS.
 */
import dynamic from "next/dynamic";

export const BlueprintDesigner = dynamic(
  () => import("./BlueprintDesigner").then((m) => m.BlueprintDesigner),
  { ssr: false, loading: () => <div className="skeleton h-[60vh] min-h-[420px] w-full rounded-xl" /> }
);
