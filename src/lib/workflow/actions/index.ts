/**
 * Action handler registry. Every node type that does something
 * (i.e., not a structural node like `trigger`) has a handler here.
 *
 * Handlers return a `HandlerResult` that tells the runner what to do next.
 * They must be idempotent — the runner may retry the same step.
 */

import type { Tx } from "@/db/client";
import type { RunContext } from "../context";
import type { WorkflowNode } from "../schema";

import { sendWhatsappHandler } from "./send_whatsapp";
import { sendEmailHandler } from "./send_email";
import { sendSmsHandler } from "./send_sms";
import { createTaskHandler } from "./create_task";
import { updateFieldHandler } from "./update_field";
import { assignUserHandler } from "./assign_user";
import { httpRequestHandler } from "./http_request";
import { aiComposeHandler } from "./ai_compose";
import { addToSegmentHandler } from "./add_to_segment";
import { raiseAlertHandler } from "./raise_alert";
import { createNotificationHandler } from "./create_notification";
import { sendPushHandler } from "./send_push";
import { delayHandler } from "./delay";
import { waitUntilDateHandler } from "./wait_until_date";
import { waitForEventHandler } from "./wait_for_event";
import { branchHandler } from "./branch";
import { loopHandler } from "./loop";
import { endHandler } from "./end";
import { triggerHandler } from "./trigger";

export interface HandlerResult {
  /** What the runner should do next. */
  kind: "continue" | "pause" | "end";
  /** If 'pause', the timestamp until which the run is parked. */
  until?: Date;
  /** If 'pause' for wait_for_event, the predicate the inbound event must satisfy. */
  waitPredicate?: Record<string, unknown>;
  /** Node id of the wait_for_event node (so resume routes correctly). */
  waitNodeId?: string;
  /** Source handle for branch nodes — controls which outgoing edge is taken. */
  sourceHandle?: string;
  /** Output to persist on the step (visible in run viewer + downstream). */
  output?: Record<string, unknown>;
  /** Variables to merge into the run's `variables` jsonb. */
  varsPatch?: Record<string, unknown>;
}

export interface ActionHandler<T extends WorkflowNode = WorkflowNode> {
  type: T["type"];
  execute(ctx: RunContext, node: T, tx: Tx): Promise<HandlerResult>;
}

export const handlers = {
  trigger: triggerHandler,
  send_whatsapp: sendWhatsappHandler,
  send_email: sendEmailHandler,
  send_sms: sendSmsHandler,
  create_task: createTaskHandler,
  update_field: updateFieldHandler,
  assign_user: assignUserHandler,
  http_request: httpRequestHandler,
  ai_compose: aiComposeHandler,
  add_to_segment: addToSegmentHandler,
  raise_alert: raiseAlertHandler,
  create_notification: createNotificationHandler,
  send_push: sendPushHandler,
  delay: delayHandler,
  wait_until_date: waitUntilDateHandler,
  wait_for_event: waitForEventHandler,
  branch: branchHandler,
  loop: loopHandler,
  end: endHandler,
} as const;
