"use client";

/**
 * Lazy boundary for the React Flow workflow editor — same rationale as
 * WorkflowCanvasLazy: keep the large React Flow bundle out of the route's
 * initial JS and stream it in client-side behind a skeleton.
 */
import dynamic from "next/dynamic";

export const WorkflowEditor = dynamic(
  () => import("./WorkflowEditor").then((m) => m.WorkflowEditor),
  {
    ssr: false,
    loading: () => (
      <div className="skeleton h-[70vh] min-h-[420px] w-full rounded-xl" aria-label="Loading editor…" />
    ),
  }
);
