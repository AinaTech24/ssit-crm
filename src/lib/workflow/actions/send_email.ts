import { sql } from "drizzle-orm";
import { recordOwnerUserId } from "@/lib/comms/record-owner";
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

    // Who the mail comes from, most specific first: the record's own RM,
    // then whoever built the workflow, then the firm. The owner is the default
    // — the message is about their client or their lead — and only an explicit
    // "organization" choice sends as the firm.
    let actorUserId: string | undefined =
      cfg.fromAddress === "organization"
        ? undefined
        : recordOwnerUserId(ctx.subjectType, ctx.subject as Record<string, unknown>);
    if (!actorUserId && cfg.fromAddress !== "organization") {
      const owner = await tx.execute(
        sql`SELECT created_by FROM workflows
             WHERE id = ${ctx.workflowId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
             LIMIT 1`
      );
      const createdBy = (owner.rows[0] as { created_by?: string | null } | undefined)?.created_by;
      if (createdBy) actorUserId = String(createdBy);
    }

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
      // Unattended: deliver as the firm rather than fail if the author's
      // mailbox is not connected.
      allowFirmFallback: true,
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
