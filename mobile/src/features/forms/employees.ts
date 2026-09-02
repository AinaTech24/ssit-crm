/**
 * Invite team member form — parity with the web /dashboard/employees/new page.
 * POSTs to /api/employees/invite with { name, email, roles[] }.
 *
 * Roles is a MULTI-select (checkbox grid on web, chip multi-select on mobile),
 * default ["rm"]. The web also does not navigate on success (it shows a
 * generated invite link) — so redirect returns null (go back / stay).
 */

import type { FormSpec } from "./types";

const u = (v: string) => (v?.trim() ? v.trim() : undefined);

export const employeeForm: FormSpec = {
  title: "Invite team member",
  endpoint: "/api/employees/invite",
  submitLabel: "Generate invite link",
  invalidate: ["employees"],

  initial: () => ({
    name: "",
    email: "",
    roles: ["rm"],
  }),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.email?.trim()) e.email = "Work email is required";
    if (!Array.isArray(v.roles) || v.roles.length === 0) e.roles = "Pick at least one role";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      fields: [
        { key: "name", label: "Name" },
        { key: "email", label: "Work email", type: "email", required: true },
        {
          key: "roles",
          label: "Roles",
          type: "multiselect",
          required: true,
          help: "Tap to select one or more.",
          options: [
            { value: "rm", label: "Relationship Manager" },
            { value: "back_office", label: "Back Office" },
            { value: "marketing", label: "Marketing" },
            { value: "compliance", label: "Compliance / DDQ" },
            { value: "branch_head", label: "Branch Head" },
            { value: "team_member", label: "Limited Team Member" },
          ],
        },
      ],
    },
  ],

  buildBody: (form) => ({
    name: form.name,
    email: form.email,
    roles: Array.isArray(form.roles) ? form.roles : [],
  }),

  // Web shows the generated invite link inline and does not navigate; the
  // response returns { inviteUrl } (no record id). Just go back.
  redirect: () => null,
};
