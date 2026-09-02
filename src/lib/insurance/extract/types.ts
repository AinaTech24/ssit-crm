/**
 * Shared types for the insurance document-understanding pipeline.
 *
 * Every extracted value is a `Field<T>` carrying provenance — value, model
 * confidence (0..1), a human-readable source label, and the 1-based page it was
 * found on — so the UI can auto-fill confident fields, flag medium-confidence
 * ones for review, and let the RM click straight to the evidence.
 */

export type DocKind = "digital_pdf" | "scanned_pdf" | "image";

export type PageText = { page: number; text: string };

export type Field<T = string> = {
  value: T | null;
  confidence: number; // 0..1
  source: string | null; // e.g. "Policyholder Details", "Premium Receipt"
  page: number | null; // 1-based
};

/** Deterministic regex candidates, each tagged with the page it appeared on. */
export type Candidate = { value: string; page: number };
export type Candidates = {
  emails: Candidate[];
  phones: Candidate[];
  pans: Candidate[];
  gstins: Candidate[];
  policyNumbers: Candidate[];
  dates: Candidate[];
  pinCodes: Candidate[];
  customerIds: Candidate[];
  amounts: Candidate[];
  uins: Candidate[];
};

/** Empty Field helper. */
export const NF = <T>(): Field<T> => ({ value: null, confidence: 0, source: null, page: null });

/** A typed row in one of the dynamic tables. Values stay as printed strings. */
export type TableRow = Record<string, string | null>;

/**
 * The structured result Claude returns — entities kept strictly separate so a
 * value can never leak from one to another. Mirrors the form's sections.
 */
export type StructuredExtraction = {
  documentKind: "life" | "health" | "motor" | "travel" | "general" | "policy_schedule" | "unknown";

  policy: {
    insurer: Field;
    planName: Field;
    policyNumber: Field;
    policyType: Field;
    businessType: Field;
    sumAssured: Field<number>;
    annualPremium: Field<number>;
    premiumFrequency: Field;
    commission: Field<number>;
    policyStartDate: Field; // ISO yyyy-mm-dd
    policyTermYears: Field<number>;
    premiumPayingTermYears: Field<number>;
    maturityDate: Field;
    renewalDate: Field;
  };

  policyholder: {
    name: Field;
    customerId: Field;
    uin: Field;
    email: Field;
    mobile: Field;
    address: Field;
    city: Field;
    state: Field;
    postalCode: Field;
    country: Field;
  };

  proposer: {
    name: Field;
    pan: Field;
    status: Field;
    customerId: Field;
    phone: Field;
    email: Field;
    address: Field;
    city: Field;
    state: Field;
    postalCode: Field;
    country: Field;
    remarks: Field;
  };

  nominee: { name: Field; relation: Field; sharePercent: Field<number> };

  agency: {
    agencyCode: Field;
    agencyName: Field;
    agentName: Field;
    agentEmail: Field;
    agentPhone: Field;
  };

  receipt: {
    receiptNumber: Field;
    receiptDate: Field;
    businessChannel: Field;
    taxInvoiceNumber: Field;
    taxInvoiceDate: Field;
    gstin: Field;
    pan: Field;
    paymentDetails: Field;
  };

  premiumSummary: {
    grossPremium: Field<number>;
    financialYear: Field;
    eightyDAmount: Field<number>;
  };

  // Dynamic tables — arrays of rows, never merged across entities.
  insuredMembers: TableRow[];
  sumInsured: TableRow[];
  optionalCovers: TableRow[];
  premiumDetails: TableRow[];
  exclusions: TableRow[];

  overallConfidence: number;
  warnings: string[];
};
