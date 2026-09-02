/**
 * `send_push` — deliver a mobile push notification to users by role / explicit
 * id / the subject's RM, via their registered devices (the `devices` table).
 *
 * Mirrors `create_notification` (same audience block, same `resolveRecipients`)
 * but the channel is the phone instead of the in-app bell. Pair the two in a
 * recipe when you want both: the bell badge AND a push the RM sees on the lock
 * screen ("SIP rejected for Sharma family", "New high-intent lead assigned").
 *
 * The `linkUrl` rides along as `data.url`; the app opens it in the dashboard
 * WebView when the user taps the notification (deep link).
 *
 * Idempotency: delivery is naturally at-most-recipient here, and Expo de-dupes
 * by token within a request. The runner's retry is safe — re-sending is a
 * no-op-ish double push at worst, never a data write.
 */

import { resolveExpression } from "../context";
import { resolveRecipients } from "./create_notification";
import { sendPushToUsers } from "@/lib/push/expo";
import type { ActionHandler } from "./index";

export const sendPushHandler: ActionHandler<any> = {
  type: "send_push",
  async execute(ctx, node, tx) {
    const cfg = node.config ?? {};
    const title = String(resolveExpression(cfg.title ?? "Growth OS", ctx));
    const body = cfg.body ? String(resolveExpression(cfg.body, ctx)) : undefined;
    const linkUrl = cfg.linkUrl ? String(resolveExpression(cfg.linkUrl, ctx)) : undefined;

    const recipientIds = await resolveRecipients(ctx, tx, cfg.audience ?? {});
    if (!recipientIds.length) {
      return { kind: "continue", output: { sent: 0, reason: "no_recipients" } };
    }

    const result = await sendPushToUsers(tx, ctx.tenantId, recipientIds, {
      title,
      body,
      data: linkUrl ? { url: linkUrl } : {},
    });

    return {
      kind: "continue",
      output: {
        recipientCount: recipientIds.length,
        devicesTargeted: result.targeted,
        sent: result.sent,
        disabled: result.disabled,
      },
    };
  },
};
