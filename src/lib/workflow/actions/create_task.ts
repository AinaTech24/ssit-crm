import type { ActionHandler } from "./index";

/**
 * create_task action — DISABLED per firm preference ("turn off all auto tasks").
 *
 * Workflows/recipes with a create_task step now skip it and continue to the next
 * node instead of adding a task. The original implementation (assignee
 * resolution, due/SLA offsets, the insert) lives in git history — restore it to
 * re-enable automated task creation.
 */
export const createTaskHandler: ActionHandler<any> = {
  type: "create_task",
  async execute(ctx) {
    ctx.log("create_task skipped — auto task creation is disabled");
    return { kind: "continue", output: { taskId: null, assigneeId: null, dueAt: null }, varsPatch: { lastTaskId: null } };
  },
};
