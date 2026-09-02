"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type NodeChange,
  type EdgeChange,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { v4 as uuid } from "uuid";
import {
  Plus,
  Save,
  Upload,
  Play,
  Pause,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

import type { WorkflowGraph, WorkflowNode } from "@/lib/workflow/schema";
import { formatRelative } from "@/lib/utils";

type Props = {
  workflowId: string;
  workflow: any;
  initialGraph: WorkflowGraph;
  versions: any[];
  recentRuns: any[];
};

const NODE_PALETTE: Array<{
  type: WorkflowNode["type"];
  label: string;
  color: string;
}> = [
  { type: "send_whatsapp", label: "Send WhatsApp", color: "bg-emerald-50 border-emerald-300" },
  { type: "send_email", label: "Send Email", color: "bg-blue-50 border-blue-300" },
  { type: "send_sms", label: "Send SMS", color: "bg-sky-50 border-sky-300" },
  { type: "create_task", label: "Create task", color: "bg-amber-50 border-amber-300" },
  { type: "update_field", label: "Update field", color: "bg-orange-50 border-orange-300" },
  { type: "assign_user", label: "Assign user", color: "bg-yellow-50 border-yellow-300" },
  { type: "branch", label: "Branch (if/else)", color: "bg-indigo-50 border-indigo-300" },
  { type: "delay", label: "Delay", color: "bg-slate-50 border-slate-300" },
  { type: "wait_until_date", label: "Wait until date", color: "bg-slate-50 border-slate-300" },
  { type: "wait_for_event", label: "Wait for event", color: "bg-purple-50 border-purple-300" },
  { type: "loop", label: "Loop", color: "bg-cyan-50 border-cyan-300" },
  { type: "http_request", label: "HTTP request", color: "bg-gray-50 border-gray-300" },
  { type: "ai_compose", label: "AI compose", color: "bg-fuchsia-50 border-fuchsia-300" },
  { type: "add_to_segment", label: "Add to segment", color: "bg-teal-50 border-teal-300" },
  { type: "raise_alert", label: "Raise alert", color: "bg-rose-50 border-rose-300" },
  { type: "end", label: "End", color: "bg-zinc-100 border-zinc-300" },
];

export function WorkflowEditor(props: Props) {
  const router = useRouter();
  const [graph, setGraph] = useState<WorkflowGraph>(props.initialGraph);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const flowNodes = useMemo<Node[]>(() => toFlowNodes(graph, selectedId), [graph, selectedId]);
  const flowEdges = useMemo<Edge[]>(() => toFlowEdges(graph), [graph]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setGraph((g) => {
      // Only persist position changes; structural changes go through our own buttons.
      const next = { ...g };
      const movedById: Record<string, { x: number; y: number }> = {};
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          movedById[ch.id] = ch.position;
        }
      }
      if (Object.keys(movedById).length === 0) return g;
      next.nodes = g.nodes.map((n: any) =>
        movedById[n.id] ? { ...n, position: movedById[n.id] } : n
      );
      return next;
    });
  }, []);

  const onEdgesChange = useCallback((_: EdgeChange[]) => {
    /* edges are managed via our own connect handler */
  }, []);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    setGraph((g) => ({
      ...g,
      edges: [
        ...g.edges,
        {
          id: uuid(),
          source: c.source!,
          target: c.target!,
          sourceHandle: c.sourceHandle ?? undefined,
        },
      ],
    }));
  }, []);

  function addNode(type: WorkflowNode["type"]) {
    const id = uuid();
    const newNode: any = { id, type, config: defaultConfig(type) };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, newNode] }));
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    if (selectedId === graph.startNodeId) {
      setErr("Cannot delete the trigger node");
      return;
    }
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.filter((n: any) => n.id !== selectedId),
      edges: g.edges.filter((e) => e.source !== selectedId && e.target !== selectedId),
    }));
    setSelectedId(null);
  }

  function patchSelected(patch: any) {
    if (!selectedId) return;
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n: any) =>
        n.id === selectedId ? { ...n, ...patch, config: { ...n.config, ...(patch.config ?? {}) } } : n
      ),
    }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workflows/${props.workflowId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setErr(null);
    try {
      // Save draft first
      await fetch(`/api/workflows/${props.workflowId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph }),
      });
      const res = await fetch(`/api/workflows/${props.workflowId}/publish`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Publish failed");
        return;
      }
      router.refresh();
    } finally {
      setPublishing(false);
    }
  }

  async function togglePause() {
    await fetch(`/api/workflows/${props.workflowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !props.workflow.enabled }),
    });
    router.refresh();
  }

  const selectedNode = graph.nodes.find((n: any) => n.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{props.workflow.name}</h1>
          <p className="text-sm text-muted-foreground">{props.workflow.description ?? "Workflow editor"}</p>
        </div>
        <div className="flex gap-2">
          {savedAt && (
            <span className="text-xs text-muted-foreground self-center">Saved {formatRelative(savedAt)}</span>
          )}
          <button
            onClick={togglePause}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5"
          >
            {props.workflow.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {props.workflow.enabled ? "Pause" : "Enable"}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5"
          >
            <Save className="size-3.5" /> {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={publish}
            disabled={publishing}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Upload className="size-3.5" /> {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>

      {err && (
        <div className="border border-rose-300 bg-rose-50 text-rose-700 rounded-md px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle className="size-4" /> {err}
        </div>
      )}

      <div className="grid grid-cols-[180px_1fr_320px] gap-3 h-[600px]">
        {/* Palette */}
        <div className="border rounded-lg bg-card overflow-y-auto">
          <div className="px-3 py-2 border-b font-medium text-xs uppercase text-muted-foreground">Add node</div>
          <div className="p-2 space-y-1">
            {NODE_PALETTE.map((p) => (
              <button
                key={p.type}
                onClick={() => addNode(p.type)}
                className={`w-full text-left text-xs px-2.5 py-2 rounded border ${p.color} hover:opacity-80 flex items-center justify-between`}
              >
                <span>{p.label}</span>
                <Plus className="size-3" />
              </button>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="border rounded-lg overflow-hidden bg-card">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background gap={16} />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <div className="border rounded-lg bg-card p-4 overflow-y-auto">
          {selectedNode ? (
            <NodeInspector node={selectedNode} onPatch={patchSelected} onDelete={deleteSelected} />
          ) : (
            <div className="text-sm text-muted-foreground">
              Click a node to edit its config. Click the canvas to deselect.
              <div className="mt-4 text-xs">
                <div className="font-medium mb-1">Quick tips</div>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Drag from a node's right edge to another to connect.</li>
                  <li>Branch nodes have multiple output handles (one per case).</li>
                  <li>Save creates a draft. Publish activates for new runs.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent runs */}
      {props.recentRuns.length > 0 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Recent runs</h2>
          <ul className="divide-y text-sm">
            {props.recentRuns.map((r: any) => (
              <li key={r.id} className="py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={r.status} />
                  <span>{r.subjectType ?? "—"}</span>
                  <span className="text-xs text-muted-foreground font-mono">{r.id.slice(0, 8)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NodeInspector({
  node,
  onPatch,
  onDelete,
}: {
  node: any;
  onPatch: (p: any) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase text-muted-foreground font-semibold">{node.type}</div>
        {node.type !== "trigger" && (
          <button
            onClick={onDelete}
            className="text-xs text-rose-600 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
      <div className="font-mono text-xs text-muted-foreground">id: {node.id.slice(0, 8)}</div>

      {/* Per-type config */}
      {node.type === "trigger" && (
        <Field label="Trigger kind">
          <select
            value={node.config?.kind ?? "manual"}
            onChange={(e) => onPatch({ config: { kind: e.target.value } })}
            className="w-full text-sm border rounded px-2 py-1.5 bg-background"
          >
            <option value="manual">Manual</option>
            <option value="record_event">Record event</option>
            <option value="schedule">Schedule (cron)</option>
            <option value="inbound_message">Inbound WhatsApp</option>
            <option value="segment_entry">Segment entry</option>
            <option value="webhook">Webhook</option>
          </select>
        </Field>
      )}

      {(node.type === "send_whatsapp" || node.type === "send_email" || node.type === "send_sms") && (
        <>
          <Field label="Template key">
            <input
              value={node.config?.templateKey ?? ""}
              onChange={(e) => onPatch({ config: { templateKey: e.target.value } })}
              placeholder="sip_rejection_low_balance"
              className="w-full text-sm border rounded px-2 py-1.5 bg-background font-mono"
            />
          </Field>
          <Field label="Recipient">
            <select
              value={node.config?.recipientType ?? "subject"}
              onChange={(e) => onPatch({ config: { recipientType: e.target.value } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            >
              <option value="subject">Subject (investor/lead)</option>
              <option value="rm">Assigned RM</option>
              <option value="owner">Owner</option>
              <option value="custom">Custom (expression)</option>
            </select>
          </Field>
        </>
      )}

      {node.type === "create_task" && (
        <>
          <Field label="Title">
            <input
              value={node.config?.title ?? ""}
              onChange={(e) => onPatch({ config: { title: e.target.value } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
              placeholder="Confirm balance and retry SIP"
            />
          </Field>
          <Field label="Priority">
            <select
              value={node.config?.priority ?? "normal"}
              onChange={(e) => onPatch({ config: { priority: e.target.value } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Due in (days)">
            <input
              type="number"
              value={node.config?.dueInDays ?? 1}
              onChange={(e) => onPatch({ config: { dueInDays: Number(e.target.value) } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            />
          </Field>
        </>
      )}

      {node.type === "delay" && (
        <Field label="Wait for">
          <div className="flex gap-2">
            <input
              type="number"
              value={node.config?.duration?.amount ?? 1}
              onChange={(e) =>
                onPatch({
                  config: { duration: { ...(node.config?.duration ?? {}), amount: Number(e.target.value) } },
                })
              }
              className="w-20 text-sm border rounded px-2 py-1.5 bg-background"
            />
            <select
              value={node.config?.duration?.unit ?? "hour"}
              onChange={(e) =>
                onPatch({
                  config: { duration: { ...(node.config?.duration ?? {}), unit: e.target.value } },
                })
              }
              className="flex-1 text-sm border rounded px-2 py-1.5 bg-background"
            >
              <option value="minute">Minutes</option>
              <option value="hour">Hours</option>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
            </select>
          </div>
        </Field>
      )}

      {node.type === "branch" && (
        <div className="text-xs text-muted-foreground">
          Branch nodes evaluate criteria and route to one of multiple outputs. Configure via JSON below for now —
          a guided UI ships next.
          <textarea
            value={JSON.stringify(node.config ?? {}, null, 2)}
            onChange={(e) => {
              try {
                onPatch({ config: JSON.parse(e.target.value) });
              } catch {}
            }}
            rows={8}
            className="mt-2 w-full text-xs font-mono border rounded px-2 py-1.5 bg-background"
          />
        </div>
      )}

      {node.type === "raise_alert" && (
        <>
          <Field label="Title">
            <input
              value={node.config?.title ?? ""}
              onChange={(e) => onPatch({ config: { title: e.target.value } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            />
          </Field>
          <Field label="Severity">
            <select
              value={node.config?.severity ?? "warning"}
              onChange={(e) => onPatch({ config: { severity: e.target.value } })}
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
        </>
      )}

      {/* Raw config inspector for unsupported node types */}
      {!["trigger", "send_whatsapp", "send_email", "send_sms", "create_task", "delay", "branch", "raise_alert"].includes(node.type) && (
        <Field label="Config (JSON)">
          <textarea
            value={JSON.stringify(node.config ?? {}, null, 2)}
            onChange={(e) => {
              try {
                onPatch({ config: JSON.parse(e.target.value) });
              } catch {}
            }}
            rows={10}
            className="w-full text-xs font-mono border rounded px-2 py-1.5 bg-background"
          />
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function defaultConfig(type: string): any {
  switch (type) {
    case "send_whatsapp":
      return { templateKey: "", recipientType: "subject" };
    case "send_email":
      return { templateKey: "", recipientType: "subject" };
    case "send_sms":
      return { templateKey: "", recipientType: "subject" };
    case "create_task":
      return { title: "New task", priority: "normal", dueInDays: 1 };
    case "delay":
      return { duration: { amount: 1, unit: "hour" } };
    case "branch":
      return { cases: [{ name: "yes", criteria: null }], default: "no" };
    case "loop":
      return { itemsExpression: "vars.items", maxIterations: 100 };
    case "raise_alert":
      return { title: "Alert", severity: "warning", recipients: ["owner"] };
    case "ai_compose":
      return { storeAs: "draft", prompt: "" };
    case "update_field":
      return { updates: {} };
    case "assign_user":
      return { strategy: "round_robin" };
    case "http_request":
      return { method: "POST", url: "", headers: {} };
    case "add_to_segment":
      return { segmentKey: "" };
    case "wait_until_date":
      return { dateExpression: "" };
    case "wait_for_event":
      return { eventKind: "inbound_message.whatsapp", timeoutDays: 7 };
    case "end":
      return {};
    default:
      return {};
  }
}

function toFlowNodes(graph: WorkflowGraph, selectedId: string | null): Node[] {
  // Auto-layout for nodes that don't have explicit positions yet.
  const depthMap = computeDepth(graph);
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depthMap.entries()) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  return graph.nodes.map((n: any) => {
    const pos = n.position ?? layoutPosition(n.id, depthMap, byDepth);
    const palette = NODE_PALETTE.find((p) => p.type === n.type);
    const color = palette?.color ?? (n.type === "trigger" ? "bg-violet-50 border-violet-300" : "bg-white border-gray-300");
    return {
      id: n.id,
      position: pos,
      selected: n.id === selectedId,
      data: {
        label: (
          <div className="px-2.5 py-2 text-left">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              {palette?.label ?? n.type}
            </div>
            <div className="text-xs font-medium mt-0.5 leading-tight">{deriveLabel(n)}</div>
          </div>
        ),
      },
      className: `${color} border-2 rounded-md ${n.id === selectedId ? "ring-2 ring-primary" : ""}`,
    } as Node;
  });
}

function toFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
    style: { stroke: "#94a3b8" },
    label: e.sourceHandle,
    labelStyle: { fontSize: 10, fill: "#6b7280" },
  }));
}

function computeDepth(graph: WorkflowGraph): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const depth = new Map<string, number>();
  const start = graph.startNodeId ?? graph.nodes[0]?.id;
  if (!start) return depth;
  const stack: [string, number][] = [[start, 0]];
  while (stack.length) {
    const [id, d] = stack.pop()!;
    if ((depth.get(id) ?? -1) >= d) continue;
    depth.set(id, d);
    for (const t of adj.get(id) ?? []) stack.push([t, d + 1]);
  }
  for (const n of graph.nodes) {
    if (!depth.has(n.id)) depth.set(n.id, 0);
  }
  return depth;
}

function layoutPosition(id: string, depth: Map<string, number>, byDepth: Map<number, string[]>) {
  const d = depth.get(id) ?? 0;
  const row = byDepth.get(d) ?? [];
  const idx = row.indexOf(id);
  return {
    x: (idx - (row.length - 1) / 2) * 220 + 360,
    y: d * 110 + 40,
  };
}

function deriveLabel(node: any): string {
  switch (node.type) {
    case "trigger":
      return node.config?.kind ?? "Manual";
    case "send_whatsapp":
    case "send_email":
    case "send_sms":
      return node.config?.templateKey || "(no template)";
    case "create_task":
      return node.config?.title || "Create task";
    case "branch":
      return `${(node.config?.cases ?? []).length} cases`;
    case "delay":
      return `${node.config?.duration?.amount ?? "—"} ${node.config?.duration?.unit ?? ""}`;
    case "raise_alert":
      return node.config?.title || "Alert";
    case "ai_compose":
      return `→ vars.${node.config?.storeAs}`;
    case "end":
      return "End";
    default:
      return node.type;
  }
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-emerald-500"
      : status === "running"
      ? "bg-blue-500"
      : status === "paused"
      ? "bg-amber-500"
      : status === "failed"
      ? "bg-rose-500"
      : "bg-gray-300";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}
