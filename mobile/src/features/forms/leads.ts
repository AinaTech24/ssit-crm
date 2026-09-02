/**
 * Lead create form — field-for-field parity with the web
 * /dashboard/leads/new page. Same sections, same options (values + labels),
 * same POST body to /api/leads. The web page redirects to the leads LIST on
 * success (router.push("/dashboard/leads")), so redirect() returns null.
 *
 * Notes on fidelity vs. web:
 *  - The web avatar upload (Camera → /api/compliance/upload → avatarUrl) is a
 *    file-picker side effect with no FormSpec equivalent, so it is omitted;
 *    avatarUrl is simply never sent (web sends it as undefined when empty too).
 *  - The web live duplicate scan (/api/leads/check-duplicate) is a best-effort
 *    inline warning that never blocks or alters the payload — omitted here.
 *  - The web referrer picker (InvestorLookup) is a typeahead over
 *    /api/search (envelope "investors") and returns BOTH id + name; the web
 *    POST sends referredByInvestorId + referredByName together. The mobile
 *    lookup model stores only the id, so referredByName cannot be recovered
 *    from the selection and is not sent. See "notes".
 *  - The web sub-distributor picker hits /api/sub-distributors?status=active
 *    (envelope "subDistributors"); modelled as a lookup here.
 */

import type { FormSpec } from "./types";

export const leadForm: FormSpec = {
  title: "New lead",
  endpoint: "/api/leads",
  submitLabel: "Create lead",
  invalidate: ["leads"],

  initial: {
    name: "",
    email: "",
    phone: "",
    city: "",
    source: "manual",
    referredByInvestorId: "",
    subDistributorId: "",
    ownerId: "",
    leadType: "",
    aumPotential: "",
    interestProducts: [],
    expectedBusinessAmount: "",
    followUpDate: "",
    occupation: "",
    altPhone: "",
    altEmail: "",
    currentInvestments: [],
    notes: "",
    // Edit-only (mirrors the web LeadEditPanel; shown via section visibleIf on _edit).
    _edit: "",
    pan: "",
    pincode: "",
    sourceCampaign: "",
    intendedAmount: "",
    nextFollowUpAt: "",
    followUpNotes: "",
    lostReason: "",
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.name?.trim()) e.name = "Name is required";
    // Web requires a linked referrer when source is referral / existing_client.
    if (
      (v.source === "referral" || v.source === "existing_client") &&
      !v.referredByInvestorId
    ) {
      e.referredByInvestorId = "Referred-by client is required for this source";
    }
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Contact",
      fields: [
        { key: "name", label: "Name", required: true },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "city", label: "City" },
        { key: "pan", label: "PAN", autoCapitalize: "characters", transform: (v) => v.toUpperCase(), visibleIf: (v) => v._edit === "1" },
        { key: "pincode", label: "Pincode", keyboard: "number-pad" as any, visibleIf: (v) => v._edit === "1" },
      ],
    },
    {
      title: "Source & attribution",
      fields: [
        {
          key: "source",
          label: "Source",
          type: "select",
          options: [
            { value: "referral", label: "Client Referral" },
            { value: "existing_client", label: "Existing Client Reference" },
            { value: "website", label: "Website" },
            { value: "social_media", label: "Social Media" },
            { value: "webinar", label: "Webinar" },
            { value: "seminar", label: "Seminar" },
            { value: "walk_in", label: "Walk-in" },
            { value: "google", label: "Google" },
            { value: "cold_call", label: "Cold Call" },
            { value: "other", label: "Other" },
            { value: "manual", label: "Manual entry" },
          ],
        },
        { key: "sourceCampaign", label: "Source campaign", placeholder: "e.g. Diwali webinar", visibleIf: (v) => v._edit === "1" },
        {
          key: "referredByInvestorId",
          label: "Referred by (Client)",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (r) => r.name,
          searchSublabel: (r) => [r.pan, r.phone].filter(Boolean).join(" · "),
          placeholder: "Type the existing client's name, PAN, or mobile…",
          help: "Required for Client Referral / Existing Client Reference. Links the referring client so referral credit is tracked.",
          visibleIf: (v) => v._edit !== "1",
        },
        {
          key: "subDistributorId",
          label: "Sub-distributor",
          type: "lookup",
          lookupEndpoint: "/api/sub-distributors?status=active",
          lookupEnvelope: "subDistributors",
          lookupLabel: (r) => r.name + (r.code ? ` · ${r.code}` : "") + (r.arnNumber ? ` · ARN: ${r.arnNumber}` : ""),
          placeholder: "Type sub-distributor name, code, or ARN…",
          clearable: true,
          help: "optional · channel partner credit",
          visibleIf: (v) => v._edit !== "1",
        },
        {
          key: "ownerId",
          label: "Assign RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Auto-assign via round-robin",
          clearable: true,
          help: "leave blank for auto round-robin",
        },
      ],
    },
    {
      title: "Qualification",
      visibleIf: (v) => v._edit !== "1",
      fields: [
        {
          key: "leadType",
          label: "Lead type",
          type: "select",
          options: [
            { value: "", label: "—" },
            { value: "individual", label: "Individual" },
            { value: "hni", label: "HNI" },
            { value: "nri", label: "NRI" },
            { value: "corporate", label: "Corporate" },
            { value: "minor", label: "Minor" },
          ],
        },
        {
          key: "aumPotential",
          label: "AUM potential",
          type: "select",
          options: [
            { value: "", label: "—" },
            { value: "under_10l", label: "< ₹10 L" },
            { value: "10l_50l", label: "₹10 – 50 L" },
            { value: "50l_2cr", label: "₹50 L – 2 Cr" },
            { value: "hni_2cr_plus", label: "HNI · ₹2 Cr+" },
          ],
        },
        {
          key: "interestProducts",
          label: "Products of interest",
          type: "multiselect",
          options: [
            "Equity MF", "Debt MF", "Hybrid MF", "ELSS (Tax)", "Index Funds",
            "SIP", "Lumpsum", "NPS", "Insurance", "PMS", "AIF", "FD / Bonds",
          ],
          help: "Tap all that apply.",
        },
        {
          key: "expectedBusinessAmount",
          label: "Expected business (₹)",
          type: "number",
        },
        {
          key: "followUpDate",
          label: "Follow-up date",
          type: "date",
          help: "Sets the next follow-up + creates an RM task.",
        },
      ],
    },
    {
      title: "Follow-up & pipeline",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "intendedAmount", label: "Intended amount (₹)", type: "number" },
        { key: "nextFollowUpAt", label: "Next follow-up", type: "date" },
        { key: "followUpNotes", label: "Follow-up notes", type: "textarea" },
        { key: "lostReason", label: "Lost reason", placeholder: "Only if not qualified" },
      ],
    },
    {
      title: "More details",
      visibleIf: (v) => v._edit !== "1",
      fields: [
        { key: "occupation", label: "Occupation" },
        { key: "altPhone", label: "Alternate phone", type: "tel", placeholder: "Secondary number" },
        { key: "altEmail", label: "Alternate email", type: "email", placeholder: "Secondary email" },
        {
          key: "currentInvestments",
          label: "Current investments",
          type: "multiselect",
          options: [
            "Equity MF", "Debt MF", "Hybrid MF", "ELSS (Tax)", "Index Funds",
            "SIP", "Lumpsum", "NPS", "Insurance", "PMS", "AIF", "FD / Bonds",
          ],
          help: "What they already hold elsewhere — tap all that apply.",
        },
        {
          key: "notes",
          label: "Notes",
          type: "textarea",
          placeholder: "Anything the RM should know about this lead…",
        },
      ],
    },
  ],

  buildBody: (form) => {
    // Edit mode → PATCH body (mirrors the web LeadEditPanel's editable fields).
    if (form._edit === "1") {
      const u = (v: string) => (v?.trim() ? v.trim() : undefined);
      return {
        name: form.name,
        email: form.email || "",
        phone: u(form.phone),
        pan: u(form.pan),
        city: u(form.city),
        pincode: u(form.pincode),
        source: form.source,
        sourceCampaign: u(form.sourceCampaign),
        intendedAmount: form.intendedAmount ? String(form.intendedAmount) : undefined,
        nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt + "T09:00:00").toISOString() : undefined,
        followUpNotes: u(form.followUpNotes),
        lostReason: u(form.lostReason),
        notes: u(form.notes),
      };
    }
    const products = Array.isArray(form.interestProducts) ? form.interestProducts : [];
    const current = Array.isArray(form.currentInvestments) ? form.currentInvestments : [];
    const payload: any = {
      name: form.name,
      avatarUrl: form.avatarUrl || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      city: form.city || undefined,
      source: form.source,
      notes: form.notes || undefined,
      leadType: form.leadType || undefined,
      aumPotential: form.aumPotential || undefined,
      occupation: form.occupation || undefined,
      altPhone: form.altPhone || undefined,
      altEmail: form.altEmail || undefined,
      interestProducts: products.length ? products : undefined,
      currentInvestments: current.length ? current : undefined,
      expectedBusinessAmount: form.expectedBusinessAmount
        ? Number(form.expectedBusinessAmount)
        : undefined,
      // datetime-local is local + tz-naive; send a proper ISO instant.
      followUpDate: form.followUpDate
        ? new Date(form.followUpDate).toISOString()
        : undefined,
    };
    if (form.referredByInvestorId) {
      payload.referredByInvestorId = form.referredByInvestorId;
      payload.referredByName = form.referredByName;
    }
    if (form.ownerId) payload.ownerId = form.ownerId;
    if (form.subDistributorId) payload.subDistributorId = form.subDistributorId;
    return payload;
  },

  // Web redirects to the leads LIST (router.push("/dashboard/leads")).
  redirect: () => null,

  editTitle: "Edit lead",
  // GET /api/leads/[id] returns the lead object directly (no envelope).
  editInitial: (rec) => {
    const dstr = (v: any) => (v ? String(v).slice(0, 10) : "");
    return {
      _edit: "1",
      name: rec.name ?? "",
      email: rec.email ?? "",
      phone: rec.phone ?? "",
      pan: rec.pan ?? "",
      city: rec.city ?? "",
      pincode: rec.pincode ?? "",
      source: rec.source ?? "manual",
      sourceCampaign: rec.sourceCampaign ?? "",
      intendedAmount: rec.intendedAmount ?? (rec.expectedBusinessAmount != null ? String(rec.expectedBusinessAmount) : ""),
      nextFollowUpAt: dstr(rec.nextFollowUpAt),
      followUpNotes: rec.followUpNotes ?? "",
      lostReason: rec.lostReason ?? "",
      notes: rec.notes ?? "",
      // Carried but hidden in edit:
      referredByInvestorId: rec.referredByInvestorId ?? "",
      subDistributorId: rec.subDistributorId ?? "",
      ownerId: rec.ownerId ?? "",
      leadType: rec.leadType ?? "",
      aumPotential: rec.aumPotential ?? "",
      interestProducts: rec.interestProducts ?? [],
      currentInvestments: rec.profile?.currentInvestments ?? [],
      occupation: rec.profile?.occupation ?? "",
      altPhone: rec.altPhone ?? "",
      altEmail: rec.altEmail ?? "",
      expectedBusinessAmount: rec.expectedBusinessAmount != null ? String(rec.expectedBusinessAmount) : "",
      followUpDate: "",
    };
  },
};
