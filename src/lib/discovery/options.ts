/**
 * Dropdown option lists for the Financial Discovery form — lifted from the
 * workbook's `_Lists` sheet so the in-meeting form and the public client wizard
 * offer identical, India-MFD-appropriate choices.
 */

export const FREQUENCY = ["Monthly", "Quarterly", "Half-Yearly", "Annually", "One-time"] as const;
export const YES_NO = ["Yes", "No"] as const;
export const YES_NO_NA = ["Yes", "No", "N/A"] as const;

export const ASSET_TYPES = [
  "Savings / Current A/C", "Fixed Deposit", "Recurring Deposit", "PPF / EPF / NPS",
  "MF – Equity", "MF – Debt", "MF – Hybrid", "Direct Equity / Shares", "PMS", "AIF / Hedge Fund",
  "SIF", "Real Estate", "Gold / SGB", "ULIP", "Endowment / Money Back", "Bonds / Debentures", "Other",
] as const;

export const LIABILITY_TYPES = [
  "Home Loan", "Car Loan", "Personal Loan", "Business Loan", "Education Loan", "Credit Card Outstanding", "Other",
] as const;

export const LIFE_INSURANCE_TYPES = ["Term Life", "Whole Life", "ULIP", "Endowment", "Money Back"] as const;
export const HEALTH_INSURANCE_TYPES = [
  "Health – Individual", "Health – Family Floater", "Critical Illness", "Accidental", "Other",
] as const;

export const GOAL_TYPES = [
  "Home Purchase", "Child Education", "Child Marriage", "Retirement", "Wealth Creation",
  "Emergency Fund", "Tax Saving", "Business Expansion", "Foreign Travel", "Other",
] as const;

export const TAX_SLABS = ["Nil / New Regime 0%", "5%", "10%", "15%", "20%", "30%+Surcharge"] as const;

export const RESIDENCY = [
  "Resident Indian", "NRI – USA", "NRI – UK", "NRI – UAE", "NRI – Other", "PIO / OCI", "Foreign National",
] as const;

export const RISK_PROFILES = [
  "Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive", "Very Aggressive",
] as const;

export const PRIORITY = ["Very High", "High", "Moderate", "Low", "Not a Priority"] as const;

export const REVIEW_TYPES = [
  "New Client", "Annual Review", "Portfolio Rebalance", "Goal Review", "Insurance Review", "One-Time Transaction",
] as const;

export const ADVICE_TYPES = [
  "Full Financial Plan", "Investment Advisory", "Tax Planning", "Insurance Review", "Retirement Planning", "Other",
] as const;

export const NEXT_STEPS = [
  "Send Proposal", "Schedule Follow-Up", "Complete KYC", "Open Account", "Awaiting Documents", "Deal Closed", "No Action",
] as const;

export const RM_RATINGS = ["1 – Very Low", "2 – Low", "3 – Medium", "4 – High", "5 – Very High"] as const;

export const RELATIONS = ["Self", "Spouse", "Father", "Mother", "Son", "Daughter", "Other"] as const;

export const RECO_ACTIONS = ["Open New", "Top Up Existing", "Switch / Redeem", "Review Only", "Close"] as const;

export const POLICY_STATUS = ["Active", "Lapsed", "Paid-up", "Matured"] as const;
