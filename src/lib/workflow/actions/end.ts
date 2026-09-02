import type { ActionHandler } from "./index";

export const endHandler: ActionHandler<any> = {
  type: "end",
  async execute() {
    return { kind: "end" };
  },
};
