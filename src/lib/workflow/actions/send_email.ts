import { dispatch } from "@/lib/comms/pipeline";
import { resolveExpression, resolveRecord } from "../context";
import type { ActionHandler } from "./index";

export const sendEmailHandler: ActionHandler<any> = {
  type: "send_email",
  async execute(ctx, node, tx) {
    const cfg = node.config;
    const resolvedVars = resolveRecord(cfg.variables ?? {}, ctx);
    let recipient: string | null = null;
    if (cfg.recipient.source === "fixed") {
      recipient = String(cfg.recipient.value ?? "");
    } else if (cfg.recipient.source === "context") {
      recipient = String(resolveExpression(cfg.recipient.value ?? "", ctx) ?? "");
    } else {
      recipient = String(ctx.subject?.email ?? "");
    }
    if (!recipient) throw new Error("send_email: recipient unresolved");

    // "Send from" choice (Zoho-style). "record_owner" sends from the client's RM
    // mailbox — resolveEmailSender prefers the acting user's own connected mailbox
    // and falls back to the firm mailbox if that RM hasn't connected one. Default
    // ("organization" / unset) → firm mailbox, unchanged.
    const actorUserId =
      cfg.fromAddress === "record_owner" && ctx.subjectType === "investor"
        ? (ctx.subject?.rm_id ?? ctx.subject?.rmId ?? undefined)
        : undefined;

    const result = await dispatch(tx, {
      tenantId: ctx.tenantId,
      channel: "email",
      templateKey: cfg.templateKey,
      recipient,
      variables: resolvedVars,
      category: cfg.category,
      investorId: ctx.subjectType === "investor" ? ctx.subjectId ?? undefined : undefined,
      leadId: ctx.subjectType === "lead" ? ctx.subjectId ?? undefined : undefined,
      actorUserId,
      workflowRunId: ctx.runId,
      workflowRunStepId: ctx.stepId,
      // Stable across step retries (stepId is regenerated each attempt) so Resend
      // dedupes a re-fired send instead of delivering twice.
      idempotencyKey: `wf:${ctx.runId}:${node.id}`,
      meta: { cc: cfg.cc, bcc: cfg.bcc },
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
