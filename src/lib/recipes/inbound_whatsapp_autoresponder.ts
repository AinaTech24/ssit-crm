import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Inbound WhatsApp auto-responder & router. Nothing else in the library reacts
 * to an inbound client message — this closes that gap: the moment a client
 * WhatsApps in, acknowledge instantly (so they're never left hanging),
 * notify + task the owning RM to reply within SLA.
 */
export const inboundWhatsappAutoresponderRecipe: RecipeDef = {
  key: "inbound_whatsapp_autoresponder",
  name: "Inbound WhatsApp — auto-acknowledge & route to RM",
  description:
    "When a client sends a WhatsApp message, instantly acknowledge it, notify the owning RM, and create a follow-up task so no inbound query is missed.",
  category: "service",
  tags: ["whatsapp", "inbound", "service", "sla"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "inbound_message.whatsapp", subjectType: "investor" }),
      n("ack", "send_whatsapp", {
        templateKey: "inbound_wa_ack",
        variables: { name: "subject.name" },
        category: "utility",
      }),
      n("notify_rm", "create_notification", {
        kind: "inbound.whatsapp",
        title: "New WhatsApp from {{subject.name}}",
        body: "{{subject.name}} sent a WhatsApp message. Open the conversation and reply.",
        linkUrl: "/dashboard/communications",
        severity: "info",
        audience: { roles: [], users: [], subjectRm: true },
      }),
      n("task_reply", "create_task", {
        title: "Reply to WhatsApp from {{subject.name}}",
        type: "follow_up",
        priority: "high",
        assignee: "subject.rm_id",
        dueAfter: { amount: 2, unit: "hour" },
        slaAfter: { amount: 4, unit: "hour" },
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "ack"),
      e("e1", "ack", "notify_rm"),
      e("e2", "notify_rm", "task_reply"),
      e("e3", "task_reply", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "inbound_wa_ack",
      channel: "whatsapp",
      name: "Inbound WhatsApp — acknowledgement",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}}, thanks for reaching out 🙏 We've received your message and your advisor will get back to you shortly. " +
            "For anything urgent, please call us directly.",
        },
      },
      variables: [{ key: "name", type: "string", source: "subject.name", required: true }],
    },
  ],
};
