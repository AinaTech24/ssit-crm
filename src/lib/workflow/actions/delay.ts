import type { ActionHandler } from "./index";

export const delayHandler: ActionHandler<any> = {
  type: "delay",
  async execute(ctx, node) {
    const { amount, unit } = node.config.duration as { amount: number; unit: string };
    const until = new Date();
    switch (unit) {
      case "minute": until.setMinutes(until.getMinutes() + amount); break;
      case "hour":   until.setHours(until.getHours() + amount); break;
      case "day":    until.setDate(until.getDate() + amount); break;
      case "week":   until.setDate(until.getDate() + amount * 7); break;
      case "month":  until.setMonth(until.getMonth() + amount); break;
      default: throw new Error(`Unknown delay unit: ${unit}`);
    }
    ctx.log(`delay until ${until.toISOString()}`);
    return { kind: "pause", until, output: { until: until.toISOString() } };
  },
};
