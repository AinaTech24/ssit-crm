import { e, graph, n } from "./_helpers";
import type { RecipeDef } from ".";

/**
 * Documents received → convert lead + create operations tasks
 * (Onboarding flow #2).
 *
 * Fires on event `documents.received` (emitted by the public docs form).
 *
 * Sequence:
 *   1. Update lead stage to `docs_received` (already done by the API, idempotent here).
 *   2. Convert the lead to an investor via http_request → /api/leads/[id]/convert.
 *   3. Create 4 operations tasks bound to the new investor:
 *        a. KYC verification
 *        b. UCC / CAN creation
 *        c. NACH mandate setup
 *        d. First transaction execution
 *   4. Notify the operations team that a new client is ready to onboard.
 */
export const docsReceivedConvertRecipe: RecipeDef = {
  key: "docs_received_convert",
  name: "Documents received → convert lead + fan out ops tasks",
  description:
    "When a lead uploads their KYC documents, automatically convert the lead to a client and create the standard operations checklist (KYC, UCC, Mandate, First transaction).",
  category: "onboarding",
  tags: ["lead", "conversion", "operations", "kyc"],
  graph: graph({
    start: "trigger",
    nodes: [
      n("trigger", "trigger", {}),

      // Convert lead → investor via API (HTTP request to internal endpoint)
      n("convert", "http_request", {
        url: "{{system.api_base}}/internal/leads/convert",
        method: "POST",
        bodyTemplate: JSON.stringify({
          tenantId: "{{tenant.id}}",
          leadId: "{{subject.id}}",
        }),
        storeResultAs: "conversion",
      }),

      // Create the 4 operations tasks — all assigned to back-office department.
      n("task_kyc", "create_task", {
        title: "KYC verification for {{vars.conversion.investorName}}",
        description: "Review uploaded PAN + Aadhar + photo. Initiate CKYC fetch / KRA validation.",
        type: "kyc",
        priority: "high",
        assignee: "round_robin:back_office",
        department: "back_office",
        dueAfter: { amount: 2, unit: "day" },
        subjectType: "investor",
      }),
      n("task_ucc", "create_task", {
        title: "Create UCC / CAN for {{vars.conversion.investorName}}",
        description: "Set up the Unique Client Code at BSE Star MF / NSE NMF II / MFU once KYC clears.",
        type: "ucc_creation",
        priority: "high",
        assignee: "round_robin:back_office",
        department: "back_office",
        dueAfter: { amount: 3, unit: "day" },
        subjectType: "investor",
      }),
      n("task_mandate", "create_task", {
        title: "NACH mandate registration for {{vars.conversion.investorName}}",
        description: "Initiate eMandate / paper NACH form. Cancelled cheque already on file.",
        type: "mandate",
        priority: "high",
        assignee: "round_robin:back_office",
        department: "back_office",
        dueAfter: { amount: 5, unit: "day" },
        subjectType: "investor",
      }),
      n("task_first_txn", "create_task", {
        title: "First transaction execution for {{vars.conversion.investorName}}",
        description: "Execute the first SIP / lumpsum per approved proposal.",
        type: "transaction_execution",
        priority: "high",
        assignee: "round_robin:back_office",
        department: "back_office",
        dueAfter: { amount: 7, unit: "day" },
        subjectType: "investor",
      }),

      // In-app + email alert to back-office team
      n("notify_ops", "create_notification", {
        kind: "client.onboarding.started",
        severity: "info",
        title: "New client to onboard: {{vars.conversion.investorName}}",
        body:
          "Documents have been received. 4 operations tasks have been created. Click to open the client's onboarding pipeline.",
        linkUrl: "/dashboard/onboarding",
        audience: { roles: ["back_office", "ops", "owner"], users: [], subjectRm: false },
      }),

      n("end", "end", {}),
    ],
    edges: [
      e("e0", "trigger", "convert"),
      e("e1", "convert", "task_kyc"),
      e("e2", "task_kyc", "task_ucc"),
      e("e3", "task_ucc", "task_mandate"),
      e("e4", "task_mandate", "task_first_txn"),
      e("e5", "task_first_txn", "notify_ops"),
      e("e6", "notify_ops", "end"),
    ],
  }),
};
