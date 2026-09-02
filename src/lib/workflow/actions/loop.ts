import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

/**
 * Loop nodes iterate over an array stored in run variables (or context).
 *
 * Implementation strategy: rather than executing children inline, we set
 * `vars.<itemAlias>` for each iteration and re-emit the loop body via the
 * outgoing `body` edge. When the body finishes, the runner detects the
 * loop's iteration counter and either iterates again or exits.
 *
 * To keep this simple in v1, the loop handler runs at most one item per
 * execute() call — the runner re-enters the loop node after the body
 * completes. We track iteration count in vars.__loop_<nodeId>_idx.
 */
export const loopHandler: ActionHandler<any> = {
  type: "loop",
  async execute(ctx, node) {
    const items = resolveExpression(node.config.itemsExpression, ctx);
    const arr = Array.isArray(items) ? items : [];
    const counterKey = `__loop_${node.id}_idx`;
    const idx = Number(ctx.vars[counterKey] ?? 0);

    if (idx >= arr.length || idx >= node.config.maxIterations) {
      ctx.log(`loop done at idx=${idx} (len=${arr.length})`);
      return {
        kind: "continue",
        sourceHandle: "done",
        output: { iterations: idx },
        varsPatch: { [counterKey]: null, [node.config.itemAlias]: null },
      };
    }

    const next = arr[idx];
    ctx.log(`loop iter ${idx} item=${JSON.stringify(next)}`);
    return {
      kind: "continue",
      sourceHandle: "body",
      output: { idx, item: next },
      varsPatch: { [counterKey]: idx + 1, [node.config.itemAlias]: next },
    };
  },
};
