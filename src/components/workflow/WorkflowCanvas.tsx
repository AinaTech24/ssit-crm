"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { WorkflowGraph } from "@/lib/workflow/schema";

const nodeStyles: Record<string, { bg: string; border: string; label: string }> = {
  trigger: { bg: "bg-violet-50", border: "border-violet-300", label: "Trigger" },
  send_whatsapp: { bg: "bg-emerald-50", border: "border-emerald-300", label: "WhatsApp" },
  send_email: { bg: "bg-blue-50", border: "border-blue-300", label: "Email" },
  send_sms: { bg: "bg-sky-50", border: "border-sky-300", label: "SMS" },
  create_task: { bg: "bg-amber-50", border: "border-amber-300", label: "Task" },
  update_field: { bg: "bg-orange-50", border: "border-orange-300", label: "Update" },
  assign_user: { bg: "bg-yellow-50", border: "border-yellow-300", label: "Assign" },
  http_request: { bg: "bg-gray-50", border: "border-gray-300", label: "HTTP" },
  ai_compose: { bg: "bg-fuchsia-50", border: "border-fuchsia-300", label: "AI compose" },
  add_to_segment: { bg: "bg-teal-50", border: "border-teal-300", label: "Segment" },
  raise_alert: { bg: "bg-rose-50", border: "border-rose-300", label: "Alert" },
  delay: { bg: "bg-slate-50", border: "border-slate-300", label: "Delay" },
  wait_until_date: { bg: "bg-slate-50", border: "border-slate-300", label: "Wait until" },
  wait_for_event: { bg: "bg-purple-50", border: "border-purple-300", label: "Wait for event" },
  branch: { bg: "bg-indigo-50", border: "border-indigo-300", label: "Branch" },
  loop: { bg: "bg-cyan-50", border: "border-cyan-300", label: "Loop" },
  end: { bg: "bg-zinc-100", border: "border-zinc-300", label: "End" },
};

export function WorkflowCanvas({ graph }: { graph: WorkflowGraph }) {
  const { nodes, edges } = useMemo(() => layout(graph), [graph]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} />
      <MiniMap />
      <Controls />
    </ReactFlow>
  );
}

function layout(graph: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  // Compute longest-path topological depth for vertical spacing
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const depth = new Map<string, number>();
  function visit(id: string, d: number) {
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    for (const t of adj.get(id) ?? []) visit(t, d + 1);
  }
  visit(graph.startNodeId, 0);
  // Group by depth → horizontal spread
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth.entries()) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  const nodes: Node[] = graph.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = byDepth.get(d) ?? [];
    const idx = row.indexOf(n.id);
    const x = (idx - (row.length - 1) / 2) * 220 + 360;
    const y = d * 110 + 40;
    const style = nodeStyles[n.type] ?? { bg: "bg-white", border: "border-gray-300", label: n.type };
    const label = (n as any).label ?? deriveLabel(n);
    return {
      id: n.id,
      position: { x, y },
      data: {
        label: (
          <div className="px-2.5 py-2 text-left">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              {style.label}
            </div>
            <div className="text-xs font-medium mt-0.5 leading-tight">{label}</div>
          </div>
        ),
      },
      style: {
        background: undefined,
        border: undefined,
        padding: 0,
      },
      className: `${style.bg} border-2 ${style.border} rounded-md text-foreground`,
    } as Node;
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.sourceHandle?.startsWith("case_") || e.sourceHandle === "default" || e.sourceHandle === "body" || e.sourceHandle === "done"
      ? e.sourceHandle
      : undefined,
    labelStyle: { fontSize: 10, fill: "#6b7280" },
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
    style: { stroke: "#94a3b8" },
  }));

  return { nodes, edges };
}

function deriveLabel(node: any): string {
  switch (node.type) {
    case "send_whatsapp":
    case "send_email":
    case "send_sms":
      return node.config?.templateKey ?? "(no template)";
    case "create_task":
      return node.config?.title ?? "Create task";
    case "branch":
      return `${(node.config?.cases ?? []).length} cases`;
    case "delay":
      return `${node.config?.duration?.amount} ${node.config?.duration?.unit}`;
    case "ai_compose":
      return `→ vars.${node.config?.storeAs}`;
    case "update_field":
      return Object.keys(node.config?.updates ?? {}).join(", ") || "update";
    case "raise_alert":
      return node.config?.title ?? "Alert";
    case "loop":
      return `loop over ${node.config?.itemsExpression}`;
    case "trigger":
      return "Start";
    case "end":
      return "End";
    default:
      return node.type;
  }
}
