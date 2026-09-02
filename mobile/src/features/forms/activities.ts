/**
 * Log activity ("Log call / visit") form — parity with the web ActivityLogger
 * drawer. Subject picker (client OR lead), kind pills, call-only fields
 * (direction / outcome / duration), a one-line subject, notes, occurred-on and
 * an optional next follow-up. POSTs the exact camelCase body to /api/activities.
 */

import type { FormSpec } from "./types";

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const toIso = (day?: string) => (day ? new Date(`${day}T12:00:00`).toISOString() : undefined);

export const activityForm: FormSpec = {
  title: "Log activity",
  endpoint: "/api/activities",
  submitLabel: "Save activity",
  invalidate: ["activities"],

  initial: (params) => ({
    subjectType: params.leadId ? "lead" : "investor",
    investorId: params.investorId ?? "",
    leadId: params.leadId ?? "",
    kind: "call",
    direction: "outbound",
    status: "",
    durationMin: "",
    subject: "",
    notes: "",
    occurredDay: todayIso(),
    nextFollowupDay: "",
  }),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (v.subjectType === "investor" && !v.investorId) e.investorId = "Pick a client";
    if (v.subjectType === "lead" && !v.leadId) e.leadId = "Pick a lead";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Who & what",
      fields: [
        {
          key: "subjectType", label: "Log against", type: "select",
          options: [{ value: "investor", label: "Client" }, { value: "lead", label: "Lead" }],
        },
        {
          key: "investorId", label: "Client", type: "typeahead",
          searchEndpoint: "/api/search", searchEnvelope: "investors",
          searchLabel: (i) => i.name, searchSublabel: (i) => [i.pan, i.segment_tag].filter(Boolean).join(" · "),
          placeholder: "Search a client by name or PAN…",
          visibleIf: (v) => v.subjectType === "investor",
        },
        {
          key: "leadId", label: "Lead", type: "typeahead",
          searchEndpoint: "/api/search", searchEnvelope: "leads",
          searchLabel: (l) => l.name, searchSublabel: (l) => [l.phone, l.stage ? String(l.stage).replace(/_/g, " ") : ""].filter(Boolean).join(" · "),
          placeholder: "Search a lead by name or phone…",
          visibleIf: (v) => v.subjectType === "lead",
        },
        {
          key: "kind", label: "Type", type: "select",
          options: [
            { value: "call", label: "Call" }, { value: "visit", label: "Visit" }, { value: "note", label: "Note" },
            { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "other", label: "Other" },
          ],
        },
      ],
    },
    {
      title: "Call details",
      visibleIf: (v) => v.kind === "call",
      fields: [
        { key: "direction", label: "Direction", type: "select", options: [{ value: "outbound", label: "Outbound" }, { value: "inbound", label: "Inbound" }] },
        {
          key: "status", label: "Outcome", type: "select",
          options: [
            { value: "", label: "— Not set —" }, { value: "answered", label: "Answered" }, { value: "completed", label: "Completed" },
            { value: "no_answer", label: "No answer" }, { value: "busy", label: "Busy" }, { value: "left_voicemail", label: "Left voicemail" }, { value: "no_show", label: "No-show" },
          ],
        },
        { key: "durationMin", label: "Duration (min)", type: "number" },
      ],
    },
    {
      title: "Details",
      fields: [
        { key: "subject", label: "Summary", placeholder: "e.g. SIP top-up discussion" },
        { key: "notes", label: "Notes / outcome", type: "textarea" },
        { key: "occurredDay", label: "Occurred on", type: "date" },
        { key: "nextFollowupDay", label: "Next follow-up (optional)", type: "date" },
      ],
    },
  ],

  buildBody: (form, params) => {
    const subjectId = form.subjectType === "investor" ? (form.investorId || params.investorId) : (form.leadId || params.leadId);
    const body: Record<string, any> = {
      subjectType: form.subjectType,
      subjectId,
      kind: form.kind,
      subject: form.subject || undefined,
      notes: form.notes || undefined,
      occurredAt: toIso(form.occurredDay),
      nextFollowupAt: toIso(form.nextFollowupDay),
    };
    if (form.kind === "call") {
      body.direction = form.direction || undefined;
      if (form.status) body.status = form.status;
      const min = parseFloat(form.durationMin);
      if (min > 0) body.durationSec = Math.round(min * 60);
    }
    return body;
  },

  redirect: () => null,
};
