/**
 * Task create form — field-for-field parity with the web
 * /dashboard/tasks/new page (Module 18). Three sections: What / Related to /
 * Routing + schedule. Same options, same conditional custom-type + recurrence,
 * same related-entity pickers, same POST body to /api/tasks.
 */

import type { FormSpec } from "./types";

const DEPARTMENTS: Array<{ value: string; label: string }> = [
  { value: "", label: "Select" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "back_office", label: "Back Office" },
  { value: "compliance", label: "Compliance" },
  { value: "marketing", label: "Marketing" },
  { value: "advisory", label: "Advisory" },
  { value: "support", label: "Support" },
  { value: "leadership", label: "Leadership" },
  { value: "other", label: "Other" },
];

function defaultDueDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function meetingLabel(m: any): string {
  const raw = m.meeting_date ?? m.meetingDate;
  const date = raw
    ? new Date(raw).toLocaleString("en-IN", { day: "numeric", month: "short" })
    : "—";
  const inv = m.investor_name ?? m.investorName ?? "—";
  const cat = String(m.category ?? "review").replace(/_/g, " ");
  return `${date} · ${inv} · ${cat}`;
}

const KNOWN_TYPES = ["follow_up", "review_meeting", "collect_document", "kyc_renewal", "mandate_renewal"];

export const taskForm: FormSpec = {
  title: "New task",
  editTitle: "Edit task",
  endpoint: "/api/tasks",
  submitLabel: "Create task",
  invalidate: ["tasks"],

  // Prefill from GET /api/tasks/[id] when editing (?editId=).
  editInitial: (r) => {
    const type = KNOWN_TYPES.includes(r.type) ? r.type : "custom";
    return {
      title: r.title ?? "",
      description: r.description ?? "",
      remarks: r.remarks ?? "",
      relatedInvestorId: r.relatedInvestorId ?? "",
      relatedLeadId: r.relatedLeadId ?? "",
      relatedServiceRequestId: r.relatedServiceRequestId ?? "",
      relatedMeetingId: r.relatedMeetingId ?? "",
      type,
      customType: type === "custom" ? r.type ?? "" : "",
      department: r.department ?? "",
      priority: r.priority ?? "normal",
      dueDate: r.dueAt ? String(r.dueAt).slice(0, 10) : "",
      assigneeId: r.assigneeId ?? "",
      _recurring: !!r.recurrence,
      recurrence: r.recurrence ?? "",
      recurrenceUntil: r.recurrenceUntil ? String(r.recurrenceUntil).slice(0, 10) : "",
    };
  },

  initial: {
    title: "",
    description: "",
    remarks: "",
    relatedInvestorId: "",
    relatedLeadId: "",
    relatedServiceRequestId: "",
    relatedMeetingId: "",
    type: "follow_up",
    customType: "",
    department: "",
    priority: "normal",
    dueDate: defaultDueDate(3),
    assigneeId: "",
    _recurring: false,
    recurrence: "",
    recurrenceUntil: "",
  },

  // Recurrence checkbox → recurrence value (matches the web: checking sets
  // "monthly"; the Frequency select then edits it; unchecking clears it).
  derive: (v) => {
    if (!v._recurring && v.recurrence) return { recurrence: "", recurrenceUntil: "" };
    if (v._recurring && !v.recurrence) return { recurrence: "monthly" };
    return null;
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.title?.trim()) e.title = "Title is required.";
    if (v.type === "custom" && !v.customType?.trim()) e.customType = "Enter a name for the custom task type.";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "1. What",
      fields: [
        { key: "title", label: "Title", required: true },
        { key: "description", label: "Description", type: "textarea" },
        { key: "remarks", label: "Remarks (live notes — appended over time)", type: "textarea" },
      ],
    },
    {
      title: "2. Related to (any combination)",
      fields: [
        {
          key: "relatedInvestorId",
          label: "Related client",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (r) => r.name,
          searchSublabel: (r) => [r.pan, r.phone].filter(Boolean).join(" · "),
          placeholder: "Search clients…",
        },
        {
          key: "relatedLeadId",
          label: "Related lead",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "leads",
          searchLabel: (l) => l.name,
          searchSublabel: (l) => `${l.stage ?? "—"} · ${l.source ?? "—"}`,
          placeholder: "Search leads by name…",
        },
        {
          key: "relatedServiceRequestId",
          label: "Related service request",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "serviceRequests",
          searchLabel: (sr) => sr.ticket_no ?? sr.id,
          searchSublabel: (sr) => `${sr.subject ?? "—"} · ${sr.status ?? "—"}`,
          placeholder: "Search SR by ticket no. or subject…",
        },
        {
          key: "relatedMeetingId",
          label: "Related meeting",
          type: "lookup",
          lookupEndpoint: "/api/review-meetings",
          lookupEnvelope: "meetings",
          lookupLabel: meetingLabel,
          placeholder: "Pick a recent meeting (optional)",
        },
      ],
    },
    {
      title: "3. Routing + schedule",
      fields: [
        {
          key: "type",
          label: "Type",
          type: "select",
          options: [
            { value: "follow_up", label: "Follow-up" },
            { value: "review_meeting", label: "Review meeting" },
            { value: "collect_document", label: "Collect document" },
            { value: "kyc_renewal", label: "KYC renewal" },
            { value: "mandate_renewal", label: "Mandate renewal" },
            { value: "custom", label: "Custom" },
          ],
        },
        {
          key: "customType",
          label: "Custom type name",
          placeholder: "Custom type name (e.g. Portfolio rebalance)",
          visibleIf: (v) => v.type === "custom",
        },
        { key: "department", label: "Department", type: "select", options: DEPARTMENTS },
        {
          key: "priority",
          label: "Priority",
          type: "select",
          options: [
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ],
        },
        { key: "dueDate", label: "Due date", type: "date" },
        {
          key: "assigneeId",
          label: "Assign to",
          type: "lookup",
          lookupEndpoint: "/api/employees",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Assign to myself",
          help: "defaults to you",
        },
        {
          key: "_recurring",
          label: "Repeat this task (recurring)",
          type: "switch",
          help: "When you complete it, the next occurrence is created automatically with its due date advanced.",
        },
        {
          key: "recurrence",
          label: "Frequency",
          type: "select",
          visibleIf: (v) => !!v._recurring,
          options: [
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "quarterly", label: "Quarterly" },
            { value: "yearly", label: "Yearly" },
          ],
        },
        {
          key: "recurrenceUntil",
          label: "Repeat until (optional)",
          type: "date",
          visibleIf: (v) => !!v._recurring,
        },
      ],
    },
  ],

  buildBody: (form) => {
    const payload: any = {
      title: form.title,
      description: form.description || undefined,
      type: form.type === "custom" ? form.customType.trim() : form.type,
      priority: form.priority,
      dueAt: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      department: form.department || undefined,
      assigneeId: form.assigneeId || undefined,
      remarks: form.remarks || undefined,
    };
    if (form.recurrence) {
      payload.recurrence = form.recurrence;
      if (form.recurrenceUntil) payload.recurrenceUntil = form.recurrenceUntil;
    }
    if (form.relatedInvestorId) payload.relatedInvestorId = form.relatedInvestorId;
    if (form.relatedLeadId) payload.relatedLeadId = form.relatedLeadId;
    if (form.relatedServiceRequestId) payload.relatedServiceRequestId = form.relatedServiceRequestId;
    if (form.relatedMeetingId) payload.relatedMeetingId = form.relatedMeetingId;
    return payload;
  },

  // Web pushes to the tasks list after create.
  redirect: () => null,
};
