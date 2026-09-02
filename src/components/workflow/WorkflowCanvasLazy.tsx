"use client";

/**
 * Lazy boundary for the React Flow canvas. React Flow is a large, non
 * tree-shakeable dependency; loading it only when the canvas actually renders
 * keeps it out of the route's initial JS (the page paints, the canvas streams
 * in a moment later behind a skeleton). ssr:false because the canvas is purely
 * client-interactive and needs no server HTML.
 */
import dynamic from "next/dynamic";

export const WorkflowCanvas = dynamic(
  () => import("./WorkflowCanvas").then((m) => m.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="skeleton h-[420px] w-full rounded-xl" aria-label="Loading canvas…" />
    ),
  }
);
