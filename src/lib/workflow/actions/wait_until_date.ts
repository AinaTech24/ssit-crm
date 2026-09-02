import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

export const waitUntilDateHandler: ActionHandler<any> = {
  type: "wait_until_date",
  async execute(ctx, node) {
    const exprResult = resolveExpression(node.config.expression, ctx);
    const target = parseDate(exprResult);
    if (!target || isNaN(target.getTime())) {
      throw new Error(`wait_until_date: could not resolve expression '${node.config.expression}'`);
    }
    if (target <= new Date()) {
      ctx.log(`wait_until_date already past (${target.toISOString()}), continuing`);
      return { kind: "continue", output: { resolvedAt: target.toISOString(), elapsed: true } };
    }
    return { kind: "pause", until: target, output: { until: target.toISOString() } };
  },
};

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    // Allow "now+P30D" style relative expressions
    if (v.startsWith("now+")) {
      const match = v.match(/^now\+(\d+)([dhwMmy])$/);
      if (match) {
        const n = Number(match[1]);
        const u = match[2];
        const d = new Date();
        if (u === "d") d.setDate(d.getDate() + n);
        else if (u === "h") d.setHours(d.getHours() + n);
        else if (u === "w") d.setDate(d.getDate() + n * 7);
        else if (u === "M") d.setMonth(d.getMonth() + n);
        else if (u === "m") d.setMinutes(d.getMinutes() + n);
        else if (u === "y") d.setFullYear(d.getFullYear() + n);
        return d;
      }
    }
    return new Date(v);
  }
  if (typeof v === "number") return new Date(v);
  return null;
}
