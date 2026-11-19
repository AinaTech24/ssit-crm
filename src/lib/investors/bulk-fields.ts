/**
 * Fields the Clients "Update a field" bulk action may set, grouped for the picker.
 *
 * One list drives both sides: the dialog builds its dropdown and value input from it,
 * and POST /api/investors/bulk validates against it, so a field that is not here can
 * never be written by a bulk call. Deliberately NOT here: KYC status, risk profile,
 * PAN, bank, nominees and anything else that carries a compliance trail of its own -
 * those are changed one client at a time, where the trail is kept.
 *
 * Pure data (no server imports) so the client component can use it too.
 */

export type BulkFieldKind = "select" | "date" | "text" | "tag_add" | "tag_remove";

export type BulkField = {
  key: string;
  label: string;
  kind: BulkFieldKind;
  options?: Array<{ value: string; label: string }>;
  /** Where the value is written; address parts are merged into investors.address. */
  target: "column" | "address" | "tags";
  column?: string;
  placeholder?: string;
};

export type BulkFieldGroup = { group: string; fields: BulkField[] };

const opts = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

export const BULK_FIELD_GROUPS: BulkFieldGroup[] = [
  {
    group: "Service",
    fields: [
      { key: "serviceTier", label: "Service tier", kind: "select", target: "column", column: "serviceTier",
        options: opts([["A", "Tier A - quarterly review"], ["B", "Tier B - half-yearly review"], ["C", "Tier C - annual review"]]) },
      { key: "reviewFrequency", label: "Review frequency", kind: "select", target: "column", column: "reviewFrequency",
        options: opts([["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["annual", "Annual"]]) },
      { key: "nextReviewAt", label: "Next review date", kind: "date", target: "column", column: "nextReviewAt" },
      { key: "statementCadence", label: "Statement emails", kind: "select", target: "column", column: "statementCadence",
        options: opts([["off", "Off"], ["monthly", "Monthly"], ["quarterly", "Quarterly"]]) },
      { key: "languagePref", label: "Language", kind: "select", target: "column", column: "languagePref",
        options: opts([["en", "English"], ["hi", "Hindi"], ["gu", "Gujarati"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"], ["kn", "Kannada"], ["bn", "Bengali"], ["ml", "Malayalam"], ["pa", "Punjabi"]]) },
      { key: "onboardedAt", label: "Onboarded on", kind: "date", target: "column", column: "onboardedAt" },
    ],
  },
  {
    group: "Classification",
    fields: [
      { key: "clientCategory", label: "Client category", kind: "select", target: "column", column: "clientCategory",
        options: opts([["A", "Category A"], ["B", "Category B"], ["C", "Category C"], ["D", "Category D"]]) },
      { key: "segmentTag", label: "Segment", kind: "select", target: "column", column: "segmentTag",
        options: opts([["HNI", "HNI"], ["Affluent", "Affluent"], ["Retail", "Retail"], ["NRI", "NRI"], ["Corporate", "Corporate"]]) },
      { key: "investorCategory", label: "Investor type", kind: "select", target: "column", column: "investorCategory",
        options: opts([["individual", "Individual"], ["huf", "HUF"], ["corporate", "Corporate"], ["company", "Company"], ["trust", "Trust"], ["nri", "NRI"], ["minor", "Minor"], ["other", "Other"]]) },
      { key: "householdType", label: "Family or individual", kind: "select", target: "column", column: "householdType",
        options: opts([["Individual", "Individual"], ["Family", "Family"], ["Family head", "Family head"], ["Family member", "Family member"]]) },
      { key: "modeOfHolding", label: "Mode of holding", kind: "select", target: "column", column: "modeOfHolding",
        options: opts([["Single", "Single"], ["Joint", "Joint"], ["Anyone or Survivor", "Anyone or Survivor"]]) },
    ],
  },
  {
    group: "Profile",
    fields: [
      { key: "occupation", label: "Occupation", kind: "text", target: "column", column: "occupation", placeholder: "e.g. Doctor" },
      { key: "incomeRange", label: "Income range", kind: "text", target: "column", column: "incomeRange", placeholder: "e.g. 10-25 Lakh" },
      { key: "taxStatus", label: "Tax status", kind: "text", target: "column", column: "taxStatus", placeholder: "e.g. Resident Individual" },
    ],
  },
  {
    group: "Address",
    fields: [
      { key: "city", label: "City", kind: "text", target: "address", placeholder: "e.g. Vadodara" },
      { key: "state", label: "State", kind: "text", target: "address", placeholder: "e.g. Gujarat" },
      { key: "country", label: "Country", kind: "text", target: "address", placeholder: "e.g. India" },
    ],
  },
  {
    group: "Tags",
    fields: [
      { key: "tag_add", label: "Add a tag", kind: "tag_add", target: "tags", placeholder: "Tag to add" },
      { key: "tag_remove", label: "Remove a tag", kind: "tag_remove", target: "tags", placeholder: "Tag to remove" },
    ],
  },
];

export function findBulkField(key: string): BulkField | undefined {
  for (const g of BULK_FIELD_GROUPS) {
    const f = g.fields.find((x) => x.key === key);
    if (f) return f;
  }
  return undefined;
}
