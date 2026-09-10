import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Meeting confirmation + day-before reminder.
 *
 * Fires on `review_meeting.scheduled`. The emitting API now points the event's
 * entity at the *person* (investor/lead), so the workflow subject resolves to
 * someone we can message. Flow:
 *
 *   1. Immediately WhatsApp + email a confirmation to the client.
 *   2. wait_until_date(event.reminderAt)  — meeting minus 1 day.
 *   3. WhatsApp a "see you tomorrow" reminder.
 *
 * Ships disabled like every recipe — the owner reviews + enables it. Closes the
 * gap that *nothing* consumed review_meeting.scheduled, so scheduling a meeting
 * never reached the client (only an internal RM reminder task was created).
 */
export const meetingConfirmationRecipe: RecipeDef = {
  key: "meeting_confirmation",
  name: "Meeting confirmation + reminder",
  description:
    "When a meeting is scheduled, send the client a WhatsApp + email confirmation, then a WhatsApp reminder the day before. Cuts no-shows.",
  category: "service",
  tags: ["meeting", "reminder", "no-show", "engagement"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", { kind: "review_meeting.scheduled" }),
      n("confirm_wa", "send_whatsapp", {
        templateKey: "meeting_confirmation_wa",
        variables: {
          name: "subject.name",
          type: "event.meetingType",
          date: "event.meetingDate",
          mode: "event.mode",
        },
        category: "utility",
      }),
      n("confirm_email", "send_email", {
        templateKey: "meeting_confirmation_email",
        variables: {
          name: "subject.name",
          type: "event.meetingType",
          date: "event.meetingDate",
          mode: "event.mode",
          location: "event.locationOrLink",
        },
        category: "transactional",
      }),
      // Pause until 1 day before the meeting (already-past → continues at once).
      n("wait_t1", "wait_until_date", { expression: "event.reminderAt" }),
      n("reminder_wa", "send_whatsapp", {
        templateKey: "meeting_reminder_wa",
        variables: {
          name: "subject.name",
          type: "event.meetingType",
          date: "event.meetingDate",
          mode: "event.mode",
        },
        category: "utility",
      }),
      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "confirm_wa"),
      e("e1", "confirm_wa", "confirm_email"),
      e("e2", "confirm_email", "wait_t1"),
      e("e3", "wait_t1", "reminder_wa"),
      e("e4", "reminder_wa", "end"),
    ],
  }),
  defaultTemplates: [
    {
      key: "meeting_confirmation_wa",
      channel: "whatsapp",
      name: "Meeting confirmation (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}} 👋\n\n" +
            "This confirms our *{{type}}* on *{{date}}* ({{mode}}).\n\n" +
            "Looking forward to it — reply here if you'd like to reschedule. See you then!",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "type", type: "string", source: "event.meetingType", required: true },
        { key: "date", type: "date", source: "event.meetingDate", required: true, format: "dd MMM yyyy, h:mm a" },
        { key: "mode", type: "string", source: "event.mode", required: false, fallback: "as planned" },
      ],
    },
    {
      key: "meeting_reminder_wa",
      channel: "whatsapp",
      name: "Meeting reminder — tomorrow (WA)",
      category: "utility",
      body: {
        body: {
          text:
            "Hi {{name}}, a quick reminder of our *{{type}}* tomorrow ({{date}}, {{mode}}).\n\n" +
            "If anything's changed, just reply and we'll re-arrange. Talk soon!",
        },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "type", type: "string", source: "event.meetingType", required: true },
        { key: "date", type: "date", source: "event.meetingDate", required: true, format: "dd MMM yyyy, h:mm a" },
        { key: "mode", type: "string", source: "event.mode", required: false, fallback: "as planned" },
      ],
    },
    {
      key: "meeting_confirmation_email",
      channel: "email",
      name: "Meeting confirmation (Email)",
      category: "transactional",
      body: {
        mode: "designer",
        subject: "Confirmed: your {{type}} on {{date}}",
        preheader: "We're looking forward to meeting you.",
        theme: {
          brandColor: "#d22e32",
          accentColor: "#841f21",
          pageBackground: "#f5f7fb",
          cardBackground: "#ffffff",
          textColor: "#111827",
          mutedColor: "#6b7280",
          fontFamily: "sans",
          baseFontSize: 15,
          containerWidth: 600,
          cornerRadius: 12,
          logoHeight: 40,
          logoAlign: "center",
        },
        blocks: [
          { id: "b1", type: "logo" },
          {
            id: "b2",
            type: "hero",
            title: "Your meeting is confirmed ✅",
            subtitle: "{{type}} · {{date}}",
            imageUrl: "",
            imageAlt: "",
            align: "center",
          },
          {
            id: "b3",
            type: "text",
            html:
              "Hi {{name}},<br/><br/>" +
              "This confirms our <b>{{type}}</b> on <b>{{date}}</b> ({{mode}}). {{location}}<br/><br/>" +
              "If you'd like to reschedule, just reply to this email and we'll find a better time.<br/><br/>" +
              "Looking forward to speaking with you.",
            align: "left",
          },
        ],
        footer: { includeArn: true, includeAddress: true, includeUnsubscribe: false },
      },
      variables: [
        { key: "name", type: "string", source: "subject.name", required: true },
        { key: "type", type: "string", source: "event.meetingType", required: true },
        { key: "date", type: "date", source: "event.meetingDate", required: true, format: "dd MMM yyyy, h:mm a" },
        { key: "mode", type: "string", source: "event.mode", required: false, fallback: "as planned" },
        { key: "location", type: "string", source: "event.locationOrLink", required: false, fallback: "" },
      ],
    },
  ],
};
