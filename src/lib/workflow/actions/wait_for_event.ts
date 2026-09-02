import type { ActionHandler } from "./index";

/**
 * Park the run until a matching event arrives. The outbox processor sees the
 * `wait_predicate` row, matches incoming events, and resumes the run at
 * `wait_node_id` taking the 'matched' edge. If the timeout fires first,
 * we resume taking the 'timeout' edge.
 */
export const waitForEventHandler: ActionHandler<any> = {
  type: "wait_for_event",
  async execute(ctx, node) {
    const { eventKind, criteria, timeout } = node.config;
    let until: Date | undefined;
    if (timeout) {
      until = new Date();
      switch (timeout.unit) {
        case "minute": until.setMinutes(until.getMinutes() + timeout.amount); break;
        case "hour":   until.setHours(until.getHours() + timeout.amount); break;
        case "day":    until.setDate(until.getDate() + timeout.amount); break;
        case "week":   until.setDate(until.getDate() + timeout.amount * 7); break;
      }
    }
    ctx.log(`wait_for_event '${eventKind}'${until ? ` until ${until.toISOString()}` : ""}`);
    return {
      kind: "pause",
      until,
      waitNodeId: node.id,
      waitPredicate: { eventKind, criteria: criteria ?? null },
      output: { eventKind, timeoutAt: until?.toISOString() ?? null },
    };
  },
};
