/**
 * Finance-management checklist — adopted from Network FP "8.6 Financial
 * Checklist". The cadence of bookkeeping / accounting / compliance tasks an
 * MFD firm should run on its own business finances.
 *
 * Pure data — rendered by the finance-checklist reference page. No DB.
 */

export type ChecklistGroup = {
  cadence: string;
  note?: string;
  items: string[];
};

export const FINANCE_CHECKLIST: ChecklistGroup[] = [
  {
    cadence: "Daily / Weekly",
    items: [
      "Record expenses incurred on a daily / weekly basis",
      "Run weekly progress meetings with self / team",
    ],
  },
  {
    cadence: "Monthly",
    items: [
      "Record all commission income received from AMCs",
      "Reconcile AMC-wise commissions with bank entries",
      "Track SIP book and new assets added (SIP + lumpsum)",
      "Calculate & pay salaries to employees",
      "Cross-check and collate all business expenses (fixed + variable)",
      "Maintain digital or physical invoices / receipts",
      "GST calculation & payment (if applicable)",
    ],
  },
  {
    cadence: "Quarterly",
    note: "June · September · December · March",
    items: [
      "Share all accounting reports & statements with your CA",
      "Check renewal dates for any software / tech subscriptions",
      "Pay advance tax before the due date",
    ],
  },
  {
    cadence: "Annual",
    note: "March / April",
    items: [
      "Download and archive annual commission reports from AMCs",
      "Prepare the annual income & expenditure statement",
      "Consolidate and categorise all expenses for the year",
      "Add all income & expense data into the P&L statement",
      "Collect and verify all TDS certificates (AMC-wise)",
      "File Income Tax Return (ITR) before the deadline",
      "Plan practice goals for next year (SIP targets, no. of families, etc.)",
      "Set / update budget for tech, team, marketing & practice growth",
    ],
  },
];
