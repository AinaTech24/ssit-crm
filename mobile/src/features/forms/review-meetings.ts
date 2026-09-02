/**
 * Review-meeting create form — field-for-field parity with the web
 * ScheduleMeetingForm (/dashboard/review-meetings/new). Same Client|Lead|Family
 * subject toggle, same meeting-type / mode / duration / status / RM fields, same
 * date+time → ISO meetingDate combine, same POST body to /api/review-meetings.
 *
 * Web nuance preserved:
 *  - The subject picker swaps by `subjectKind`. Exactly one of investorId /
 *    leadId is sent (the API enforces the XOR). A FAMILY meeting attaches to the
 *    family's PRIMARY investor + the familyId and is forced to category "review"
 *    — the web resolves the primary investor from its in-memory family list, so
 *    the family lookup here encodes "<familyId>:<primaryInvestorId>" as its value
 *    and buildBody splits it back apart.
 *  - meetingType is derived from category via TYPE_FOR_CATEGORY.
 *  - The web pushes to the review-meetings LIST after create → no detail redirect.
 */

import type { FormSpec } from "./types";

// 15-minute time slots across the day, labelled 12-hour (mirrors TIME_SLOTS).
const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
    }
  }
  return out;
})();

const TYPE_FOR_CATEGORY: Record<string, string> = {
  new: "new_investment_discussion",
  review: "portfolio_review",
  follow_up: "follow_up_call",
};

// Tomorrow at 11:00, skipping weekends (mirrors defaultDateTimeParts).
function defaultDateTimeParts(): { day: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: "11:00" };
}

export const reviewMeetingForm: FormSpec = {
  title: "Schedule review meeting",
  endpoint: "/api/review-meetings",
  submitLabel: "Schedule meeting",
  invalidate: ["review-meetings"],

  initial: (params) => {
    const def = defaultDateTimeParts();
    return {
      subjectKind: params.leadId ? "lead" : "client",
      investorId: params.investorId ?? "",
      leadId: params.leadId ?? "",
      familyId: "", // encodes "<familyId>:<primaryInvestorId>"
      subject: "",
      category: ["new", "review", "follow_up"].includes(params.category ?? "") ? params.category! : "review",
      meetingDay: def.day,
      meetingTime: def.time,
      durationMinutes: "30",
      meetingMode: "online",
      locationOrLink: "",
      discussionPoints: "",
      rmId: "",
      status: "scheduled",
    };
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.meetingDay) e.meetingDay = "Date is required";
    if (!v.meetingTime) e.meetingTime = "Time is required";
    if (v.subjectKind === "client" && !v.investorId) e.investorId = "Pick a client";
    else if (v.subjectKind === "lead" && !v.leadId) e.leadId = "Pick a lead";
    else if (v.subjectKind === "family" && !v.familyId) e.familyId = "Pick a family";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Meeting details",
      fields: [
        { key: "subject", label: "Subject" },
        {
          key: "subjectKind",
          label: "Who is the meeting with?",
          type: "select",
          options: [
            { value: "client", label: "Client" },
            { value: "lead", label: "Lead" },
            { value: "family", label: "Family" },
          ],
        },
        {
          key: "investorId",
          label: "Client",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (i) => i.name,
          searchSublabel: (i) => [i.pan, i.segment_tag].filter(Boolean).join(" · "),
          placeholder: "Search a client by name or PAN…",
        },
        {
          key: "leadId",
          label: "Lead",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "leads",
          searchLabel: (l) => l.name,
          searchSublabel: (l) => [l.phone, l.stage ? String(l.stage).replace(/_/g, " ") : ""].filter(Boolean).join(" · "),
          placeholder: "Search a lead by name or phone…",
        },
        {
          key: "familyId",
          label: "Family",
          type: "lookup",
          lookupEndpoint: "/api/families",
          lookupEnvelope: "families",
          lookupValue: (f) => `${f.id}:${f.primaryInvestorId ?? ""}`,
          lookupLabel: (f) => `${f.familyName ?? f.headName ?? "Family"}`,
          placeholder: "Search a family group…",
          clearable: true,
          help: "only families with a primary client can be met",
        },
        {
          key: "category",
          label: "Meeting type",
          type: "select",
          options: [
            { value: "new", label: "New Meeting" },
            { value: "review", label: "Review Meeting" },
            { value: "follow_up", label: "Follow-up Meeting" },
          ],
        },
        {
          key: "meetingMode",
          label: "Mode",
          type: "select",
          options: [
            { value: "office", label: "Office" },
            { value: "client_place", label: "Client Place" },
            { value: "online", label: "Online" },
            { value: "phone", label: "Phone" },
          ],
        },
        { key: "meetingDay", label: "Date", type: "date" },
        { key: "meetingTime", label: "Time", type: "select", options: TIME_SLOTS },
        { key: "durationMinutes", label: "Duration (minutes)", type: "number" },
        {
          key: "status",
          label: "Initial status",
          type: "select",
          options: [
            { value: "scheduled", label: "Scheduled" },
            { value: "confirmed", label: "Confirmed" },
          ],
        },
        {
          key: "rmId",
          label: "Assigned RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Use the client's RM",
          clearable: true,
        },
        { key: "locationOrLink", label: "Location / link" },
        { key: "discussionPoints", label: "Discussion points (agenda)", type: "textarea" },
      ],
    },
  ],

  buildBody: (form) => {
    const body: Record<string, any> = {
      subject: form.subject || undefined,
      category: form.category,
      meetingType: TYPE_FOR_CATEGORY[form.category] ?? "portfolio_review",
      meetingDate: new Date(`${form.meetingDay}T${form.meetingTime || "11:00"}:00`).toISOString(),
      durationMinutes: parseInt(form.durationMinutes, 10) || 30,
      meetingMode: form.meetingMode,
      locationOrLink: form.locationOrLink || undefined,
      discussionPoints: form.discussionPoints || undefined,
      rmId: form.rmId || undefined,
      status: form.status,
    };
    if (form.subjectKind === "client") body.investorId = form.investorId;
    else if (form.subjectKind === "lead") body.leadId = form.leadId;
    else {
      // Family → attach to the primary investor + the familyId, force review.
      const [familyId, primaryInvestorId] = String(form.familyId).split(":");
      body.investorId = primaryInvestorId || undefined;
      body.familyId = familyId || undefined;
      body.category = "review";
    }
    return body;
  },

  redirect: () => null,
};
