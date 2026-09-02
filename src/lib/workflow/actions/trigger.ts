import type { ActionHandler } from "./index";

/** Trigger nodes are pass-through — the runner enters here and immediately
 *  moves to the next node. */
export const triggerHandler: ActionHandler<any> = {
  type: "trigger",
  async execute(ctx, _node) {
    ctx.log("trigger entered");
    return { kind: "continue", output: { trigger: true } };
  },
};
