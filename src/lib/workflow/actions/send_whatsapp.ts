import { dispatch } from "@/lib/comms/pipeline";
import { resolveExpression, resolveRecord } from "../context";
import type { ActionHandler } from "./index";

export const sendWhatsappHandler: ActionHandler<any> = {
  type: "send_whatsapp",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const resolvedVars = resolveRecord(cfg.variables ?? {}, ctx);
    let recipient: string | null = null;
    if (cfg.recipient.source === "fixed") {
      recipient = String(cfg.recipient.value ?? "");
    } else if (cfg.recipient.source === "context") {
      recipient = String(resolveExpression(cfg.recipient.value ?? "", ctx) ?? "");
    } else {
      // subject
      recipient = String(ctx.subject?.whatsapp_phone ?? ctx.subject?.phone ?? "");
    }
    if (!recipient) {
      throw new Error("send_whatsapp: recipient unresolved");
    }

    const result = await dispatch(tx, {
      tenantId: ctx.tenantId,
      channel: "whatsapp",
      templateKey: cfg.templateKey,
      recipient,
      variables: resolvedVars,
      category: cfg.category,
      investorId: ctx.subjectType === "investor" ? ctx.subjectId ?? undefined : undefined,
      leadId: ctx.subjectType === "lead" ? ctx.subjectId ?? undefined : undefined,
      workflowRunId: ctx.runId,
      workflowRunStepId: ctx.stepId,
      // Stable across step retries (stepId is regenerated each attempt) so the
      // provider dedupes a re-fired send instead of delivering twice.
      idempotencyKey: `wf:${ctx.runId}:${node.id}`,
      meta: { outsideSession: cfg.outsideSession },
    });

    return {
      kind: "continue",
      output: {
        communicationId: result.communicationId,
        status: result.status,
        externalId: result.externalId,
        skipped: result.skipped,
      },
    };
  },
};
