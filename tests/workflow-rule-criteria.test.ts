import { describe, expect, it } from "vitest";
import { evaluateCriteria, validateCriteriaPattern } from "@/lib/workflow-rules/criteria";
import { unsupportedRuleFeature } from "@/lib/workflow-rules/guard";
import type { CriteriaRow } from "@/lib/workflow-rules/types";

const rows: CriteriaRow[] = [
  { field: "stage", operator: "is", value: "proposal_shared" },
  { field: "score", operator: "greater_or_equal", value: 70 },
  { field: "status", operator: "is_not", value: "lost" },
];

describe("workflow rule criteria patterns", () => {
  it("evaluates explicit Zoho-style pattern expressions", () => {
    const record = { stage: "new", score: 82, status: "active" };

    expect(evaluateCriteria(rows, "1 OR (2 AND 3)", record)).toBe(true);
    expect(evaluateCriteria(rows, "1 AND (2 OR 3)", record)).toBe(false);
    expect(evaluateCriteria(rows, "NOT 1 AND 2", record)).toBe(true);
  });

  it("rejects invalid patterns instead of silently falling back to AND", () => {
    expect(validateCriteriaPattern("1 AND 4", rows.length)).toMatchObject({ valid: false });
    expect(validateCriteriaPattern("1 AND", rows.length)).toMatchObject({ valid: false });
    expect(validateCriteriaPattern("1 AND banana", rows.length)).toMatchObject({ valid: false });
    expect(() => evaluateCriteria(rows, "1 AND 4", { stage: "proposal_shared" })).toThrow("Condition 4");
  });
});

describe("workflow rule save guard", () => {
  it("validates branch criteria patterns and reports the exact condition set", () => {
    const message = unsupportedRuleFeature({
      triggerType: "record_action",
      criteriaRows: rows,
      criteriaPattern: "1",
      instantActions: [],
      scheduledActions: [],
      branches: [
        {
          name: "High intent",
          criteriaRows: [rows[0]],
          criteriaPattern: "1 AND 2",
          instantActions: [],
          scheduledActions: [],
        },
      ],
    });

    expect(message).toContain("Condition 2 (High intent)");
    expect(message).toContain("Condition 2 does not exist");
  });

  it("enforces Zoho-style action limits per condition set", () => {
    const message = unsupportedRuleFeature({
      triggerType: "record_action",
      criteriaRows: [],
      criteriaPattern: "",
      instantActions: [],
      scheduledActions: Array.from({ length: 6 }, () => ({
        type: "create_task",
      })),
    });

    expect(message).toContain("scheduled actions");
    expect(message).toContain("maximum is 5");
  });
});
