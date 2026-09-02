import Link from "next/link";
import type { ElementType } from "react";
import { desc, eq } from "drizzle-orm";
import { Bell, Clock, ListChecks, Webhook, Workflow, Zap } from "lucide-react";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { MODULES } from "@/lib/workflow-rules/modules";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  send_email: "Email Notification",
  send_whatsapp: "WhatsApp Message",
  send_sms: "SMS Message",
  create_task: "Task",
  schedule_meeting: "Meeting",
  schedule_call: "Call",
  update_field: "Field Update",
  add_tag: "Add Tag",
  remove_tag: "Remove Tag",
  webhook: "Webhook",
  convert_lead: "Convert Lead",
  create_notification: "In-app Notification",
};

type RuleAction = {
  type: string;
  label?: string;
  config?: Record<string, any>;
  delay?: { amount?: number; unit?: string; anchor?: string; anchorField?: string };
};

type ActionInstance = {
  key: string;
  ruleId: string;
  ruleName: string;
  moduleKey: string;
  moduleLabel: string;
  active: boolean;
  timing: "instant" | "scheduled";
  conditionName: string;
  actionType: string;
  actionLabel: string;
  configuredLabel: string;
  summary: string;
  schedule: string;
  updatedAt: Date | null;
};

export default async function WorkflowActionsPage() {
  const session = await requireSession();
  const rules = await withTenant(session.tenantId, async (tx) =>
    tx
      .select()
      .from(workflowRules)
      .where(eq(workflowRules.tenantId, session.tenantId))
      .orderBy(workflowRules.module, workflowRules.executionOrder, desc(workflowRules.createdAt))
  );

  const actions = rules.flatMap((rule) => actionInstancesForRule(rule as any));
  const activeActions = actions.filter((a) => a.active).length;
  const scheduledActions = actions.filter((a) => a.timing === "scheduled").length;
  const webhookActions = actions.filter((a) => a.actionType === "webhook").length;
  const notificationActions = actions.filter((a) =>
    ["send_email", "send_whatsapp", "send_sms", "create_notification"].includes(a.actionType)
  ).length;
  const grouped = groupByType(actions);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <ListChecks className="size-6 text-brand-cyan" /> Workflow Actions
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/workflows/rules" className="btn-secondary">
            <Workflow className="size-4" /> Rules
          </Link>
          <Link href="/dashboard/workflows/rules/new" className="btn-primary">
            <Zap className="size-4" /> Create Rule
          </Link>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Metric icon={ListChecks} label="Actions" value={actions.length} sub={`${activeActions} on active rules`} />
        <Metric icon={Zap} label="Instant" value={actions.length - scheduledActions} sub="runs when rule matches" />
        <Metric icon={Clock} label="Scheduled" value={scheduledActions} sub="queued with delay" />
        <Metric icon={Bell} label="Notifications" value={notificationActions} sub="email, WA, SMS, in-app" />
        <Metric icon={Webhook} label="Webhooks" value={webhookActions} sub="external integrations" />
      </div>

      {actions.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          <ListChecks className="size-8 mx-auto text-muted-foreground/50" />
          <div className="mt-2 font-medium">No workflow actions configured yet.</div>
          <p className="mt-2 text-xs max-w-md mx-auto">
            Create a workflow rule with instant or scheduled actions; it will appear here for review.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="card-surface overflow-hidden">
            <div className="border-b border-border px-4 py-2.5 font-semibold text-sm">
              Action library ({actions.length})
            </div>
            <div className="max-h-[60vh] overflow-auto scrollbar-none">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Action</th>
                  <th className="text-left py-2 font-medium">Rule</th>
                  <th className="text-left py-2 font-medium">Condition</th>
                  <th className="text-left py-2 font-medium">Timing</th>
                  <th className="text-right py-2 pr-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.key} className="border-b last:border-0 hover:bg-secondary/40">
                    <td className="px-4 py-3">
                      <div className="font-medium">{action.actionLabel}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">{action.summary}</div>
                    </td>
                    <td className="py-3">
                      <Link href={`/dashboard/workflows/rules/${action.ruleId}`} className="font-medium hover:underline">
                        {action.ruleName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        {action.moduleLabel} {action.active ? "" : "(inactive)"}
                      </div>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">{action.conditionName}</td>
                    <td className="py-3 text-xs">
                      <span className={`chip ${action.timing === "scheduled" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {action.timing}
                      </span>
                      {action.schedule && <div className="text-[11px] text-muted-foreground mt-1">{action.schedule}</div>}
                    </td>
                    <td className="py-3 text-right pr-4 text-[11px] text-muted-foreground">
                      {action.updatedAt ? formatRelative(action.updatedAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="space-y-3">
            {grouped.map((group) => (
              <div key={group.type} className="card-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">{ACTION_LABELS[group.type] ?? group.type}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {group.active} active of {group.total}
                    </div>
                  </div>
                  <span className="text-xl font-semibold tabular-nums">{group.total}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-brand-cyan"
                    style={{ width: `${Math.round((group.active / Math.max(group.total, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function actionInstancesForRule(rule: any): ActionInstance[] {
  const mod = MODULES[rule.module as keyof typeof MODULES];
  const sets = [
    {
      name: "Condition 1",
      instantActions: (rule.instantActions ?? []) as RuleAction[],
      scheduledActions: (rule.scheduledActions ?? []) as RuleAction[],
    },
    ...(((rule.branches ?? []) as any[]).map((branch, i) => ({
      name: String(branch.name ?? `Condition ${i + 2}`),
      instantActions: (branch.instantActions ?? []) as RuleAction[],
      scheduledActions: (branch.scheduledActions ?? []) as RuleAction[],
    }))),
  ];

  return sets.flatMap((set, setIndex) => [
    ...set.instantActions.map((action, actionIndex) =>
      toInstance(rule, mod?.label ?? rule.module, set.name, "instant", action, `${setIndex}:i:${actionIndex}`)
    ),
    ...set.scheduledActions.map((action, actionIndex) =>
      toInstance(rule, mod?.label ?? rule.module, set.name, "scheduled", action, `${setIndex}:s:${actionIndex}`)
    ),
  ]);
}

function toInstance(
  rule: any,
  moduleLabel: string,
  conditionName: string,
  timing: "instant" | "scheduled",
  action: RuleAction,
  suffix: string
): ActionInstance {
  return {
    key: `${rule.id}:${suffix}`,
    ruleId: rule.id,
    ruleName: rule.name,
    moduleKey: rule.module,
    moduleLabel,
    active: !!rule.enabled,
    timing,
    conditionName,
    actionType: action.type,
    actionLabel: ACTION_LABELS[action.type] ?? action.type,
    configuredLabel: action.label ?? "",
    summary: summarizeAction(action),
    schedule: timing === "scheduled" ? summarizeSchedule(action) : "",
    updatedAt: rule.updatedAt ?? null,
  };
}

function summarizeAction(action: RuleAction): string {
  const c = action.config ?? {};
  const prefix = action.label ? `${action.label}: ` : "";
  switch (action.type) {
    case "send_email":
    case "send_whatsapp":
    case "send_sms":
      return `${prefix}template ${String(c.templateKey ?? "not selected")} (${String(c.category ?? "transactional")})`;
    case "create_task":
    case "schedule_call":
      return `${prefix}${String(c.title ?? "task without title")} -> ${String(c.assignee ?? "subject.rm_id")}`;
    case "schedule_meeting":
      return `${prefix}${String(c.category ?? "review")} meeting, ${String(c.mode ?? "online")}`;
    case "update_field": {
      const count = Object.keys((c.updates ?? {}) as Record<string, unknown>).length;
      return `${prefix}${count} field update${count === 1 ? "" : "s"}`;
    }
    case "add_tag":
    case "remove_tag":
      return `${prefix}${String(c.tag ?? "tag not set")}`;
    case "webhook":
      return `${prefix}${String(c.method ?? "POST")} ${String(c.url ?? "URL not set")}`;
    case "create_notification":
      return `${prefix}${String(c.title ?? "notification without title")}`;
    case "convert_lead":
      return `${prefix}convert matching lead into an investor`;
    default:
      return `${prefix}custom action config`;
  }
}

function summarizeSchedule(action: RuleAction): string {
  const delay = action.delay;
  if (!delay) return "";
  const amount = Number(delay.amount ?? 0);
  const unit = String(delay.unit ?? "day");
  const anchor = delay.anchor === "date_field" && delay.anchorField ? `from ${delay.anchorField}` : "after trigger";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ${anchor}`;
}

function groupByType(actions: ActionInstance[]) {
  const map = new Map<string, { type: string; total: number; active: number }>();
  for (const action of actions) {
    const row = map.get(action.actionType) ?? { type: action.actionType, total: 0, active: 0 };
    row.total++;
    if (action.active) row.active++;
    map.set(action.actionType, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: ElementType;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
        </div>
        <Icon className="size-5 text-brand-cyan" />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
