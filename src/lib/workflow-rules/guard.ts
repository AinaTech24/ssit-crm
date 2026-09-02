/**
 * Save-time guards for Workflow Rules (shared by POST + PATCH).
 *
 * record_action rules fire from the outbox; score_change rules piggyback on
 * edit events; date_field + recurrence rules fire from the time scanner
 * worker. Note / recommendation / competitor triggers (Zoho Zia concepts) and
 * the `create_record` / `custom_function` action stubs stay rejected at save
 * time so a user never builds an inert rule that silently never fires.
 */
import { validateCriteriaPattern } from "./criteria";

const IMPLEMENTED_TRIGGERS = new Set(["record_action", "date_field", "score_change", "recurrence"]);
const UNIMPLEMENTED_ACTIONS = new Set(["create_record", "custom_function"]);

type GuardAction = { type: string };
type GuardBranch = {
  name?: string;
  criteriaPattern?: string | null;
  criteriaRows?: unknown[];
  instantActions?: GuardAction[];
  scheduledActions?: GuardAction[];
};

const ZOHO_ACTION_LIMITS: Array<{
  label: string;
  max: number;
  types: string[];
  scheduledOnly?: boolean;
}> = [
  { label: "scheduled actions", max: 5, types: ["*"], scheduledOnly: true },
  { label: "email notifications", max: 5, types: ["send_email"] },
  { label: "tasks", max: 5, types: ["create_task"] },
  { label: "field updates", max: 5, types: ["update_field"] },
  { label: "webhooks", max: 1, types: ["webhook"] },
  { label: "custom functions", max: 1, types: ["custom_function"] },
  { label: "record creation actions", max: 1, types: ["create_record"] },
  { label: "lead conversion actions", max: 1, types: ["convert_lead"] },
];

function countTypes(actions: GuardAction[], types: string[]): number {
  if (types.includes("*")) return actions.length;
  return actions.filter((a) => types.includes(a.type)).length;
}

function validateConditionSet(label: string, branch: GuardBranch): string | null {
  const instantActions = branch.instantActions ?? [];
  const scheduledActions = branch.scheduledActions ?? [];
  const allActions = [...instantActions, ...scheduledActions];
  const bad = allActions.map((a) => a.type).find((t) => UNIMPLEMENTED_ACTIONS.has(t));
  if (bad) return `${label}: action "${bad}" is not implemented yet. Use a webhook for now.`;

  const criteriaRows = branch.criteriaRows ?? [];
  const criteria = validateCriteriaPattern(branch.criteriaPattern, criteriaRows.length);
  if (!criteria.valid) return `${label}: invalid criteria pattern - ${criteria.errors.join(" ")}`;

  for (const limit of ZOHO_ACTION_LIMITS) {
    const source = limit.scheduledOnly ? scheduledActions : allActions;
    const count = countTypes(source, limit.types);
    if (count > limit.max) {
      return `${label}: Zoho-style limit exceeded for ${limit.label}; maximum is ${limit.max}.`;
    }
  }
  return null;
}

export function unsupportedRuleFeature(input: {
  triggerType: string;
  instantActions?: Array<{ type: string }>;
  scheduledActions?: Array<{ type: string }>;
  criteriaPattern?: string | null;
  criteriaRows?: unknown[];
  branches?: GuardBranch[];
}): string | null {
  if (!IMPLEMENTED_TRIGGERS.has(input.triggerType)) {
    return `Trigger "${input.triggerType}" is not active yet. Record create/edit/delete, date-based, score-based and recurring rules all fire; note-based triggers are coming soon.`;
  }
  const mainError = validateConditionSet("Condition 1", input);
  if (mainError) return mainError;

  for (let i = 0; i < (input.branches ?? []).length; i++) {
    const branch = input.branches![i];
    const label = branch.name ? `Condition ${i + 2} (${branch.name})` : `Condition ${i + 2}`;
    const branchError = validateConditionSet(label, branch);
    if (branchError) return branchError;
  }
  return null;
}

/** Map a Postgres unique-violation on the rule-name index to a clean 409. */
export function isDuplicateNameError(e: any): boolean {
  return e?.code === "23505" || /wr_tenant_name_unique|duplicate key/i.test(String(e?.message ?? ""));
}
