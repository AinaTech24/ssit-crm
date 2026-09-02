/**
 * Recipe building DSL — small helpers that make the recipe definitions
 * compact and readable. Each helper returns a partial graph fragment that
 * the recipe stitches together.
 */

import { and, p } from "@/lib/filter/ast";
import type { WorkflowGraph } from "@/lib/workflow/schema";

export function graph(opts: {
  start: string;
  nodes: WorkflowGraph["nodes"];
  edges: WorkflowGraph["edges"];
  notes?: string;
}): WorkflowGraph {
  return {
    version: 1 as const,
    startNodeId: opts.start,
    nodes: opts.nodes,
    edges: opts.edges,
    notes: opts.notes,
  };
}

export function n(id: string, type: any, config: any, label?: string): any {
  return { id, type, config: config ?? {}, label };
}
export function e(id: string, source: string, target: string, sourceHandle?: string, label?: string): any {
  return { id, source, target, sourceHandle, label };
}

export const cron = (expr: string, cfg: Record<string, unknown> = {}) => ({
  cron: expr,
  timezone: "Asia/Kolkata",
  ...cfg,
});

export { and, p };

/** Common subject helpers */
export const subjectIsInvestor = "investor";
export const subjectIsLead = "lead";
export const subjectIsUser = "user";
