import { z } from "zod";
import { FilterASTSchema } from "@/lib/filter/ast";

/**
 * Workflow Graph Schema — the validated representation of a DAG saved in
 * `workflow_versions.graph`. The runner walks this structure step by step.
 *
 * Every node has a stable `id` (string), a `type`, and a `config` object whose
 * shape depends on `type`. Edges connect nodes by id. The graph must:
 *   - have exactly one Trigger node (or one trigger reference from workflow_triggers)
 *   - be acyclic except for `loop` nodes (which loop with a bounded iteration count)
 *   - have every non-end node connected by at least one outgoing edge
 */

// ---------------------------------------------------------------------------
// Node configs
// ---------------------------------------------------------------------------

const ChannelEnum = z.enum(["whatsapp", "email", "sms", "inapp"]);

const SendWhatsappConfig = z.object({
  templateKey: z.string(),
  /** Per-message variable overrides. Values can reference vars/context/subject. */
  variables: z.record(z.string(), z.string()).default({}),
  /** Recipient resolver — usually the subject investor's whatsapp_phone */
  recipient: z
    .object({
      source: z.enum(["subject", "context", "fixed"]).default("subject"),
      value: z.string().optional(),
    })
    .default({ source: "subject" }),
  category: z.enum(["transactional", "utility", "marketing"]).default("transactional"),
  /** Whether to bypass the 24-hour session window check (utility templates only) */
  outsideSession: z.boolean().default(true),
});

const SendEmailConfig = z.object({
  templateKey: z.string(),
  variables: z.record(z.string(), z.string()).default({}),
  recipient: z
    .object({
      source: z.enum(["subject", "context", "fixed"]).default("subject"),
      value: z.string().optional(),
    })
    .default({ source: "subject" }),
  category: z.enum(["transactional", "marketing"]).default("transactional"),
  /** "Send from" — organization mailbox (firm default) or the record owner's
   *  (client's RM) own mailbox. */
  fromAddress: z.enum(["organization", "record_owner"]).optional(),
  /** Cc / Bcc */
  cc: z.array(z.string().email()).default([]),
  bcc: z.array(z.string().email()).default([]),
});

const SendSmsConfig = z.object({
  templateKey: z.string(),
  variables: z.record(z.string(), z.string()).default({}),
  recipient: z
    .object({
      source: z.enum(["subject", "context", "fixed"]).default("subject"),
      value: z.string().optional(),
    })
    .default({ source: "subject" }),
});

const CreateTaskConfig = z.object({
  title: z.string(),
  description: z.string().optional(),
  type: z.string().default("follow_up"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** "subject.rm_id" | "fixed:<userId>" | "round_robin:rm" | "branch_head" */
  assignee: z.string().default("subject.rm_id"),
  dueAfter: z.object({ amount: z.number(), unit: z.enum(["minute", "hour", "day", "week"]) }).optional(),
  slaAfter: z.object({ amount: z.number(), unit: z.enum(["minute", "hour", "day", "week"]) }).optional(),
  subjectType: z.string().optional(), // overrides run subject if needed
});

const UpdateFieldConfig = z.object({
  /** Which entity to update — usually the subject */
  target: z.enum(["subject", "context"]).default("subject"),
  updates: z.record(z.string(), z.unknown()),
});

const AssignUserConfig = z.object({
  /** Strategy */
  strategy: z.enum(["round_robin", "least_loaded", "territory", "fixed"]).default("round_robin"),
  pool: z.array(z.string()).default([]), // user ids
  role: z.string().optional(), // filter pool by role
  fixedUserId: z.string().optional(),
  /** Where to write the assignment */
  field: z.string().default("rm_id"),
});

const HttpRequestConfig = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  headers: z.record(z.string(), z.string()).default({}),
  bodyTemplate: z.string().optional(),
  storeResultAs: z.string().optional(), // run variable name
});

const AiComposeConfig = z.object({
  prompt: z.string(),
  model: z.enum(["claude-opus-4-7", "claude-haiku-4-5-20251001"]).default("claude-haiku-4-5-20251001"),
  maxTokens: z.number().int().min(100).max(4096).default(800),
  storeAs: z.string(), // run variable name
  /** Context fields from subject + vars to inject */
  context: z.array(z.string()).default([]),
});

const AddToSegmentConfig = z.object({
  segmentId: z.string(),
  /** If false, remove from segment instead */
  add: z.boolean().default(true),
});

const RaiseAlertConfig = z.object({
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
  title: z.string(),
  body: z.string().optional(),
  audience: z
    .object({
      roles: z.array(z.string()).default(["owner"]),
      users: z.array(z.string()).default([]),
    })
    .default({ roles: ["owner"], users: [] }),
  channels: z.array(ChannelEnum).default(["inapp"]),
});

const CreateNotificationConfig = z.object({
  kind: z.string().default("workflow.alert"),
  title: z.string(),
  body: z.string().optional(),
  linkUrl: z.string().optional(),
  severity: z.enum(["info", "success", "warning", "critical"]).default("info"),
  audience: z
    .object({
      roles: z.array(z.string()).default([]),
      users: z.array(z.string()).default([]),
      subjectRm: z.boolean().default(false),
    })
    .default({ roles: [], users: [], subjectRm: false }),
});

const SendPushConfig = z.object({
  title: z.string(),
  body: z.string().optional(),
  /** Path opened in the dashboard WebView when the user taps the push. */
  linkUrl: z.string().optional(),
  audience: z
    .object({
      roles: z.array(z.string()).default([]),
      users: z.array(z.string()).default([]),
      subjectRm: z.boolean().default(false),
    })
    .default({ roles: [], users: [], subjectRm: false }),
});

const DelayConfig = z.object({
  duration: z.object({
    amount: z.number().int().nonnegative(),
    unit: z.enum(["minute", "hour", "day", "week", "month"]),
  }),
});

const WaitUntilDateConfig = z.object({
  /** "subject.next_review_at" | "now+P30D" | ISO date string */
  expression: z.string(),
});

const WaitForEventConfig = z.object({
  eventKind: z.string(),
  /** Optional criteria to match the event payload against */
  criteria: FilterASTSchema.optional(),
  timeout: z
    .object({
      amount: z.number().int().nonnegative(),
      unit: z.enum(["minute", "hour", "day", "week"]),
    })
    .optional(),
});

const BranchConfig = z.object({
  /** Each branch case maps to an outgoing edge labelled `branch_<index>`.
   *  The first matching case wins. The `default` case is taken if none match. */
  cases: z
    .array(
      z.object({
        label: z.string(),
        criteria: FilterASTSchema,
      })
    )
    .min(1),
});

const LoopConfig = z.object({
  /** Run variable that holds an array. Each iteration sets `vars.item`. */
  itemsExpression: z.string(),
  maxIterations: z.number().int().min(1).max(1000).default(100),
  itemAlias: z.string().default("item"),
});

// ---------------------------------------------------------------------------
// Node union
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  "trigger",
  "send_whatsapp",
  "send_email",
  "send_sms",
  "create_task",
  "update_field",
  "assign_user",
  "http_request",
  "ai_compose",
  "add_to_segment",
  "raise_alert",
  "create_notification",
  "send_push",
  "delay",
  "wait_until_date",
  "wait_for_event",
  "branch",
  "loop",
  "end",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

const NodeConfigByType: Record<NodeType, z.ZodTypeAny> = {
  trigger: z.object({}).passthrough(),
  send_whatsapp: SendWhatsappConfig,
  send_email: SendEmailConfig,
  send_sms: SendSmsConfig,
  create_task: CreateTaskConfig,
  update_field: UpdateFieldConfig,
  assign_user: AssignUserConfig,
  http_request: HttpRequestConfig,
  ai_compose: AiComposeConfig,
  add_to_segment: AddToSegmentConfig,
  raise_alert: RaiseAlertConfig,
  create_notification: CreateNotificationConfig,
  send_push: SendPushConfig,
  delay: DelayConfig,
  wait_until_date: WaitUntilDateConfig,
  wait_for_event: WaitForEventConfig,
  branch: BranchConfig,
  loop: LoopConfig,
  end: z.object({}).passthrough(),
};

export const WorkflowNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("trigger"), label: z.string().optional(), config: NodeConfigByType.trigger, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("send_whatsapp"), label: z.string().optional(), config: SendWhatsappConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("send_email"), label: z.string().optional(), config: SendEmailConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("send_sms"), label: z.string().optional(), config: SendSmsConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("create_task"), label: z.string().optional(), config: CreateTaskConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("update_field"), label: z.string().optional(), config: UpdateFieldConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("assign_user"), label: z.string().optional(), config: AssignUserConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("http_request"), label: z.string().optional(), config: HttpRequestConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("ai_compose"), label: z.string().optional(), config: AiComposeConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("add_to_segment"), label: z.string().optional(), config: AddToSegmentConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("raise_alert"), label: z.string().optional(), config: RaiseAlertConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("create_notification"), label: z.string().optional(), config: CreateNotificationConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("send_push"), label: z.string().optional(), config: SendPushConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("delay"), label: z.string().optional(), config: DelayConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("wait_until_date"), label: z.string().optional(), config: WaitUntilDateConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("wait_for_event"), label: z.string().optional(), config: WaitForEventConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("branch"), label: z.string().optional(), config: BranchConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("loop"), label: z.string().optional(), config: LoopConfig, position: PositionSchema().optional() }),
  z.object({ id: z.string(), type: z.literal("end"), label: z.string().optional(), config: NodeConfigByType.end, position: PositionSchema().optional() }),
]);

function PositionSchema() {
  return z.object({ x: z.number(), y: z.number() });
}

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  /** For branch nodes: 'case_<index>' or 'default'. For wait_for_event:
   *  'matched' or 'timeout'. */
  sourceHandle: z.string().optional(),
  label: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  /** Graph schema version — bump if we change shape. */
  version: z.literal(1).default(1),
  nodes: z.array(WorkflowNodeSchema).min(1).max(200),
  edges: z.array(WorkflowEdgeSchema).max(400),
  /** Default starting node id when triggered. */
  startNodeId: z.string(),
  /** Optional notes shown in editor. */
  notes: z.string().optional(),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// Validator — beyond the schema, enforce structural invariants.
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: "error" | "warning";
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export function validateGraph(graph: WorkflowGraph): {
  ok: boolean;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const startNode = graph.nodes.find((n) => n.id === graph.startNodeId);
  if (!startNode) {
    issues.push({ severity: "error", message: `startNodeId ${graph.startNodeId} not found` });
  }

  // Duplicate ids
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (seen.has(n.id)) issues.push({ severity: "error", nodeId: n.id, message: `Duplicate node id: ${n.id}` });
    seen.add(n.id);
  }

  // Edges reference existing nodes
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source)) {
      issues.push({ severity: "error", edgeId: e.id, message: `Edge source ${e.source} not in nodes` });
    }
    if (!nodeIds.has(e.target)) {
      issues.push({ severity: "error", edgeId: e.id, message: `Edge target ${e.target} not in nodes` });
    }
  }

  // Reachability from startNode
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
  }

  const reachable = new Set<string>();
  const stack = [graph.startNodeId];
  while (stack.length) {
    const n = stack.pop()!;
    if (reachable.has(n)) continue;
    reachable.add(n);
    for (const e of outgoing.get(n) ?? []) stack.push(e.target);
  }
  for (const n of graph.nodes) {
    if (!reachable.has(n.id)) {
      issues.push({ severity: "warning", nodeId: n.id, message: `Node '${n.id}' is unreachable` });
    }
  }

  // Every non-terminal node has at least one outgoing edge
  for (const n of graph.nodes) {
    if (n.type === "end") continue;
    if (!(outgoing.get(n.id)?.length ?? 0) && n.type !== "trigger") {
      // trigger may be unconnected if the workflow has no body — but warn
      issues.push({ severity: "warning", nodeId: n.id, message: `Node '${n.id}' has no outgoing edges` });
    }
  }

  // Cycle detection (excluding loop nodes which are intentional)
  const cycleEdges = detectCycles(graph);
  for (const eid of cycleEdges) {
    issues.push({ severity: "error", edgeId: eid, message: `Cycle detected via edge ${eid}` });
  }

  // Branch edge labels
  for (const n of graph.nodes) {
    if (n.type === "branch") {
      const branches = graph.edges.filter((e) => e.source === n.id);
      const labels = new Set(branches.map((e) => e.sourceHandle));
      const expected = new Set([
        ...n.config.cases.map((_, i) => `case_${i}`),
        "default",
      ]);
      for (const lbl of expected) {
        if (!labels.has(lbl)) {
          issues.push({
            severity: "warning",
            nodeId: n.id,
            message: `Branch case '${lbl}' has no outgoing edge — runs taking this path will end.`,
          });
        }
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

function detectCycles(graph: WorkflowGraph): string[] {
  const adj = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }
  const loopNodes = new Set(graph.nodes.filter((n) => n.type === "loop").map((n) => n.id));
  const state = new Map<string, "white" | "grey" | "black">();
  const cycleEdgeIds: string[] = [];

  function visit(n: string): boolean {
    state.set(n, "grey");
    for (const e of adj.get(n) ?? []) {
      // Allow cycles that pass through a loop node — bounded by config
      if (loopNodes.has(e.target)) continue;
      const tState = state.get(e.target);
      if (tState === "grey") {
        cycleEdgeIds.push(e.id);
        return true;
      }
      if (tState === "black") continue;
      if (visit(e.target)) return true;
    }
    state.set(n, "black");
    return false;
  }

  for (const node of graph.nodes) {
    if (!state.has(node.id)) visit(node.id);
  }
  return cycleEdgeIds;
}
