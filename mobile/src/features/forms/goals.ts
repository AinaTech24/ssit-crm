/**
 * Goal create form — parity with the web /dashboard/goals/new page
 * (GoalCreateForm). Same inputs, same options, same POST body to /api/goals.
 *
 * The web computes `futureTarget` live from the calculator and POSTs the
 * ROUNDED future value (so the API doesn't double-inflate). We replicate that
 * exact computation inline in buildBody:
 *   monthsLeft = monthsBetween(now, Dec 31 of targetYear)
 *   years      = max(0, round(monthsLeft) / 12)
 *   futureTarget = targetMode==="today"
 *        ? targetAmount * (1 + inflation/100) ^ years      (inflatedTarget)
 *        : targetAmount                                    (already future money)
 *
 * The web routes to the LIST after save → redirect returns null.
 */

import type { FormSpec } from "./types";

// monthsBetween(from, to) — mirrors src/lib/goal-planning/calc.ts.
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export const goalForm: FormSpec = {
  title: "Add a goal",
  endpoint: "/api/goals",
  submitLabel: "Save goal",
  invalidate: ["goals"],

  initial: (params) => ({
    investorId: params.investorId ?? "",
    name: "",
    category: "retirement",
    targetMode: "today",
    targetAmount: "",
    targetYear: String(new Date().getFullYear() + 10),
    currentValue: "",
    existingMonthlySip: "",
    expectedReturnPct: "12",
    inflationPct: "6",
    stepUpPct: "10",
    glidePath: "none",
    remarks: "",
  }),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.investorId) e.investorId = "Pick a client";
    if (!v.name?.trim()) e.name = "Goal name is required";
    if (!v.targetAmount) e.targetAmount = "Target amount is required";
    if (!v.targetYear) e.targetYear = "Target year is required";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Goal",
      fields: [
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
        { key: "name", label: "Goal name", placeholder: "e.g. Riya's college fund" },
        {
          key: "category",
          label: "Category",
          type: "select",
          options: [
            { value: "retirement", label: "Retirement" },
            { value: "child_education", label: "Child Education" },
            { value: "child_marriage", label: "Child Marriage" },
            { value: "house", label: "House" },
            { value: "car", label: "Car" },
            { value: "vacation", label: "Vacation" },
            { value: "emergency_fund", label: "Emergency Fund" },
            { value: "wealth_creation", label: "Wealth Creation" },
            { value: "other", label: "Other" },
          ],
        },
        {
          key: "targetMode",
          label: "Target amount expressed in",
          type: "select",
          options: [
            { value: "today", label: "Today's value" },
            { value: "future", label: "Target-date value" },
          ],
          help: "Today's value is inflated to the target year; target-date value is used as-is.",
        },
      ],
    },
    {
      title: "Amount & horizon",
      fields: [
        { key: "targetAmount", label: "Target amount (₹)", type: "number", placeholder: "5000000" },
        { key: "targetYear", label: "Target year", type: "number" },
        { key: "currentValue", label: "Current investment (₹)", type: "number", placeholder: "0" },
        { key: "existingMonthlySip", label: "Existing monthly SIP (₹)", type: "number", placeholder: "0" },
      ],
    },
    {
      title: "Assumptions",
      fields: [
        { key: "expectedReturnPct", label: "Return % p.a.", type: "number" },
        { key: "inflationPct", label: "Inflation % p.a.", type: "number" },
        { key: "stepUpPct", label: "SIP step-up % / yr", type: "number" },
        {
          key: "glidePath",
          label: "Glide path (de-risk near target)",
          type: "select",
          options: [
            { value: "none", label: "None (return held)" },
            { value: "conservative", label: "Conservative (de-risk from 7y)" },
            { value: "moderate", label: "Moderate (de-risk from 5y)" },
            { value: "aggressive", label: "Aggressive (de-risk from 3y)" },
          ],
          help: "Tapers the expected return as the target nears (shifts toward debt).",
        },
      ],
    },
    {
      title: "Remarks",
      fields: [{ key: "remarks", label: "Remarks", type: "textarea" }],
    },
  ],

  buildBody: (form, params) => {
    const year = parseInt(form.targetYear, 10);
    const targetDateIso = new Date(year, 11, 31).toISOString().slice(0, 10);

    // Replicate the web's live futureTarget computation.
    const targetAmount = parseFloat(form.targetAmount) || 0;
    const inflationPct = parseFloat(form.inflationPct) || 0;
    const monthsLeft = monthsBetween(new Date(), new Date(year, 11, 31));
    const years = Math.max(0, Math.round(monthsLeft) / 12);
    const futureTarget =
      form.targetMode === "today"
        ? targetAmount * Math.pow(1 + inflationPct / 100, years)
        : targetAmount;

    return {
      investorId: form.investorId || params.investorId,
      name: form.name,
      category: form.category,
      targetAmount: Math.round(futureTarget),
      targetMode: form.targetMode,
      presentTargetAmount:
        form.targetMode === "today" ? (parseFloat(form.targetAmount) || undefined) : undefined,
      inflationPct: parseFloat(form.inflationPct) || 0,
      stepUpPct: parseFloat(form.stepUpPct) || 0,
      glidePath: form.glidePath,
      targetDate: targetDateIso,
      currentValue: parseFloat(form.currentValue) || 0,
      existingMonthlySip: parseFloat(form.existingMonthlySip) || 0,
      expectedReturnPct: parseFloat(form.expectedReturnPct) || 12,
      remarks: form.remarks || undefined,
    };
  },

  // Web pushes to the goals list after save.
  redirect: () => null,
};
