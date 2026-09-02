import { buildHeaderIndexMap } from "../integrations/cams-feed-parser";

/**
 * Parsers for RTA file types beyond the daily transaction feed.
 *
 * The CAMS / KFintech distributor file formats are not publicly documented;
 * they vary between MFDs and even between months. The parsers below capture
 * the *most common* layout — extend as you onboard more MFDs.
 *
 * Each parser is `(rawText, source) → CanonicalRow[]`. Canonical means
 * "named fields, no source-specific quirks." The processor then writes
 * canonical rows to our normalised tables.
 */

export type CanonicalSipRejection = {
  pan: string;
  folioNumber: string;
  amcName: string;
  schemeName: string;
  rejectionDate: string; // YYYY-MM-DD
  amount: number;
  reason: string;        // human-readable reason
  reasonCode?: string;
};

export type CanonicalBrokerageRow = {
  pan: string;
  folioNumber: string;
  amcCode: string;
  schemeCode: string;
  schemeName: string;
  brokerageType: "upfront" | "trail" | "b30" | "other";
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  aumAmount: number;
  brokerageRate: number;
  brokerageAmount: number;
};

export type CanonicalFolioRow = {
  pan: string;
  folioNumber: string;
  amcCode: string;
  amcName: string;
  schemeCode: string;
  schemeName: string;
  units: number;
  openedAt?: string; // YYYY-MM-DD
  closedAt?: string; // YYYY-MM-DD
  value?: number;
};

export type CanonicalSipRow = {
  pan: string;
  folioNumber: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  frequency: "monthly" | "quarterly" | "weekly" | "fortnightly" | "yearly";
  sipDate?: string;
  startDate?: string;
  endDate?: string;
  nextInstallmentAt?: string;
  mandateRefNo?: string;
};

export type CanonicalMandateRow = {
  pan: string;
  mandateRefNo: string;
  bankAccountMasked?: string;
  ifsc?: string;
  amountLimit?: number;
  registeredAt?: string;
  expiresAt?: string;
  status: "pending" | "active" | "expired" | "rejected" | "cancelled";
};

export type CanonicalAumRow = {
  pan: string;
  folioNumber: string;
  schemeCode: string;
  schemeName: string;
  units: number;
  nav?: number;
  aumValue: number;
};

// ── Default mapping layouts & aliases ───────────────────────────────────

const DEFAULT_SIP_REJECT_MAP: Record<string, number> = {
  amcName: 0,
  folioNumber: 1,
  pan: 2,
  schemeName: 3,
  rejectionDate: 4,
  amount: 5,
  reasonCode: 6,
  reason: 7,
};

const SIP_REJECT_ALIASES: Record<string, string[]> = {
  amcName: ["AMC", "AMC_NAME", "AMC NAME", "FMIM_CODE", "MUTUAL_FUND", "AMC_CD", "AMC_DESC"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  rejectionDate: ["REJECT_DATE", "REJECTION_DATE", "REJ_DATE", "REJECT DATE", "REJECTION DATE", "DATE", "REJ_DT", "ORDER DATE", "ORDER_DATE"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "SIP_AMOUNT", "INSTALLMENT AMT", "INSTALLMENT_AMT", "INSTALLMENT AMOUNT", "INSTALLMENT_AMOUNT"],
  reasonCode: ["REASON_CODE", "REJ_CODE", "REJECT_CODE", "REASON CODE", "REJ CODE", "REJ_REASON", "REJ REASON", "FAIL_CODE"],
  reason: ["REASON", "REASON_DESC", "REASON DESCRIPTION", "REMARK", "REMARKS", "REJ_DESC", "REJECT_DESC", "REJECTION_REASON", "ORDER REMARK", "ORDER_REMARK", "ORDER STATUS", "ORDER_STATUS"],
};

const DEFAULT_BROKERAGE_MAP: Record<string, number> = {
  amcCode: 0,
  schemeCode: 1,
  schemeName: 2,
  folioNumber: 3,
  pan: 4,
  brokerageType: 5,
  periodStart: 6,
  periodEnd: 7,
  aumAmount: 8,
  brokerageRate: 9,
  brokerageAmount: 10,
};

const BROKERAGE_ALIASES: Record<string, string[]> = {
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_CD", "FUND", "FUND CODE"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCHEME"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "ACCOUNT NUMBER", "ACCOUNT NO"],
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  brokerageType: ["TYPE", "BROKERAGE_TYPE", "COMMISSION_TYPE", "BROK_TYPE", "COMM_TYPE", "BROKERAGE HEAD", "BRKAGE_TYPE", "FEE TYPE", "BRKAGE TYPE"],
  periodStart: ["PERIOD_START", "START_DATE", "FROM_DATE", "FROM DATE", "PERIOD START", "START DATE", "BRKAGE_FROM", "BRKAGE FROM"],
  periodEnd: ["PERIOD_END", "END_DATE", "TO_DATE", "TO DATE", "PERIOD END", "END DATE", "PROC_DATE", "PROCESS DATE"],
  aumAmount: ["AUM", "AVG_AUM", "AVERAGE_AUM", "AUM_AMOUNT", "AVG AUM", "AVERAGE AUM", "AVERAGE ASSETS", "DAILY PRODUCT", "PLOT_AMOUNT", "AMOUNT (IN RS.)"],
  brokerageRate: ["RATE", "BROKERAGE_RATE", "COMMISSION_RATE", "BROK_RATE", "COMM_RATE", "BRKAGE_RATE", "PERCENTAGE (%)", "PERCENTAGE", "BRKAGE RATE"],
  brokerageAmount: ["BROKERAGE_AMOUNT", "COMMISSION_AMOUNT", "BROK_AMOUNT", "COMM_AMOUNT", "BRKAGE_AMT", "BROKERAGE (IN RS.)", "BROKERAGE IN RS", "BRKAGE AMT", "BRKAGE_AMOUNT"],
};

const DEFAULT_FOLIO_MST_MAP = {
  pan: 0,
  folioNumber: 1,
  amcCode: 2,
  amcName: 3,
  schemeCode: 4,
  schemeName: 5,
  units: 6,
  openedAt: 7,
  closedAt: 8,
  value: 9
};

const FOLIO_MST_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "FOLIOCHK", "ACCOUNT NUMBER", "ACCOUNT NO"],
  amcCode: ["AMC", "AMC_CODE", "AMCCOD", "AMC_CD", "FUND", "FUND CODE"],
  amcName: ["AMC_NAME", "AMC NAME", "FMIM_CODE", "MUTUAL_FUND", "AMC_DESC"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION", "FUND_DESCRIPTION", "SCH_DESC"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "UNIT_BAL", "BALANCE_UNITS", "CURRENT_UNITS", "CLOS_BAL", "CLOSING_BALANCE", "CLOSE_BAL", "CLOS BAL"],
  openedAt: ["OPEN_DATE", "OPENDT", "OPENED_AT", "CREATION_DATE", "OPEN DATE", "OPEN_DT"],
  closedAt: ["CLOSE_DATE", "CLOSEDT", "CLOSED_AT", "CLOSE DATE", "CLOSE_DT"],
  value: ["AUM", "VALUE", "VALUATION", "AMOUNT", "CURR_VAL", "CURRENT_VALUE", "RUPEE_BAL", "RUPEE BAL", "CLOSING_ASSETS", "MARKET_VALUE", "AMOUNT_BAL"],
};

const DEFAULT_SIP_BOOK_MAP = {
  pan: 0,
  folioNumber: 1,
  schemeCode: 2,
  schemeName: 3,
  amount: 4,
  frequency: 5,
  sipDate: 6,
  startDate: 7,
  endDate: 8,
  nextInstallmentAt: 9,
  mandateRefNo: 10
};

const SIP_BOOK_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME"],
  amount: ["AMOUNT", "AMT", "TXN_AMT", "TXN_AMOUNT", "TRANS_AMT", "SIP_AMOUNT", "INSTALLMENT_AMOUNT"],
  frequency: ["FREQUENCY", "FREQ", "SIP_FREQ", "SIP_FREQUENCY"],
  sipDate: ["SIP_DATE", "DATE", "SIP_DAY", "DAY"],
  startDate: ["START_DATE", "SIP_START_DATE", "FROM_DATE", "FROM DATE", "START DATE"],
  endDate: ["END_DATE", "SIP_END_DATE", "TO_DATE", "TO DATE", "END DATE"],
  nextInstallmentAt: ["NEXT_DEBIT_DATE", "NEXT_INSTALLMENT_DATE", "NEXT_DUE_DATE", "NEXT_DATE", "NEXT_DEBIT", "NEXT_DT"],
  mandateRefNo: ["MANDATE_ID", "UMRN", "MANDATE_REF", "MANDATE_REF_NO", "MANDATE REF", "UMRN_NO"],
};

const DEFAULT_MANDATE_STATUS_MAP = {
  pan: 0,
  mandateRefNo: 1,
  bankAccountMasked: 2,
  ifsc: 3,
  amountLimit: 4,
  registeredAt: 5,
  expiresAt: 6,
  status: 7
};

const MANDATE_STATUS_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER"],
  mandateRefNo: ["MANDATE_ID", "UMRN", "MANDATE_REF", "MANDATE_REF_NO", "MANDATE REF", "UMRN_NO", "REF_NO", "REF_NUM"],
  bankAccountMasked: ["BANK_AC_NO", "ACCOUNT_NO", "ACCT_NO", "BANK_ACC", "ACC_NO", "ACCOUNT NO", "BANK_ACCOUNT"],
  ifsc: ["IFSC", "IFSC_CODE", "IFSC CODE", "IFS_CODE"],
  amountLimit: ["LIMIT", "AMOUNT_LIMIT", "MANDATE_AMOUNT", "MAX_AMOUNT", "AMOUNT", "LIMIT_AMT"],
  registeredAt: ["REG_DATE", "REGISTERED_AT", "REG_DT", "REG DATE", "APPROVE_DATE"],
  expiresAt: ["EXP_DATE", "EXPIRES_AT", "EXP_DT", "EXP DATE", "END_DATE"],
  status: ["STATUS", "MANDATE_STATUS", "APPROVAL_STATUS", "STATUS_DESC"],
};

const DEFAULT_AUM_STATEMENT_MAP = {
  pan: 0,
  folioNumber: 1,
  schemeCode: 2,
  schemeName: 3,
  units: 4,
  nav: 5,
  aumValue: 6
};

const AUM_STATEMENT_ALIASES: Record<string, string[]> = {
  pan: ["PAN", "INV_PAN", "PAN_NO", "PAN NO", "PAN_NUM", "PAN NUM", "INVPAN", "PAN_NUMBER", "PAN NUMBER"],
  folioNumber: ["FOLIO", "FOLIO_NO", "FOLIO_NUM", "FOLIONO", "FOLIO NO", "FOLIO NUM", "FOLIONUM", "FOL_NO", "ACCOUNT NUMBER", "SCHEME_FOLIO_NUMBER"],
  schemeCode: ["SCH_CODE", "SCHEME_CODE", "SCHEME CODE", "PRODUCT_CODE", "PRODUCT CODE", "SCHCOD", "PRODCODE", "SCH_CD", "PRODUCT"],
  schemeName: ["SCH_NAME", "SCHEME_NAME", "SCHEME NAME", "PRODUCT_NAME", "PRODUCT NAME", "SCHNAME", "PRODNAME", "FUND DESCRIPTION"],
  units: ["UNITS", "UNIT", "QTY", "QUANTITY", "NO_OF_UNITS", "NO OF UNITS", "UNIT_BAL", "BALANCE_UNITS", "CURRENT_UNITS", "CLOS_BAL"],
  nav: ["NAV", "RATE", "NAV_RATE", "PRICE"],
  aumValue: ["AUM", "VALUE", "VALUATION", "AMOUNT", "CURR_VAL", "CURRENT_VALUE", "AUM_VALUE", "CLOSING_ASSETS", "CLOSING ASSETS", "RUPEE_BAL", "MARKET_VALUE"],
};

// ── SIP rejection report ────────────────────────────────────────────────

const REASON_CODE_MAP: Record<string, string> = {
  "001": "Insufficient funds",
  "002": "Account closed",
  "003": "Mandate inactive / cancelled",
  "004": "Signature mismatch",
  "005": "Mandate amount exceeded",
  "006": "No such account",
  "007": "Frozen account",
  "008": "Other",
};

export function parseSipRejectionReport(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalSipRejection[] {
  const out: CanonicalSipRejection[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;

  const delim = getDelimiter(source, lines[0] ?? "");
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, SIP_REJECT_ALIASES, DEFAULT_SIP_REJECT_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";
    const reasonCode = val("reasonCode");

    out.push({
      amcName: val("amcName"),
      folioNumber: val("folioNumber"),
      pan: val("pan"),
      schemeName: val("schemeName"),
      rejectionDate: normaliseDate(val("rejectionDate")) ?? today(),
      amount: parseFloat(val("amount") ?? "0") || 0,
      reasonCode,
      reason:
        (reasonCode && REASON_CODE_MAP[reasonCode]) ??
        val("reason") ??
        "Unknown",
    });
  }
  return out;
}

// ── Monthly brokerage statement ─────────────────────────────────────────

export function parseBrokerageStatement(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalBrokerageRow[] {
  const out: CanonicalBrokerageRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0] ?? "");
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, BROKERAGE_ALIASES, DEFAULT_BROKERAGE_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    const typeRaw = val("brokerageType").toUpperCase();
    let brokerageType: CanonicalBrokerageRow["brokerageType"] = "other";
    if (typeRaw.includes("UPFRONT")) brokerageType = "upfront";
    else if (typeRaw.includes("TRAIL")) brokerageType = "trail";
    else if (typeRaw.includes("B30") || typeRaw.includes("B-30")) brokerageType = "b30";

    out.push({
      amcCode: val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      folioNumber: val("folioNumber"),
      pan: val("pan"),
      brokerageType,
      periodStart: normaliseDate(val("periodStart")) ?? today(),
      periodEnd: normaliseDate(val("periodEnd")) ?? today(),
      aumAmount: parseFloat(val("aumAmount") ?? "0") || 0,
      brokerageRate: parseFloat(val("brokerageRate") ?? "0") || 0,
      brokerageAmount: parseFloat(val("brokerageAmount") ?? "0") || 0,
    });
  }
  return out;
}

// ── Folio Master Dump ───────────────────────────────────────────────────

export function parseFolioMasterDump(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalFolioRow[] {
  const out: CanonicalFolioRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, FOLIO_MST_ALIASES, DEFAULT_FOLIO_MST_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      amcCode: val("amcCode"),
      amcName: val("amcName") || val("amcCode"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      units: parseFloat(val("units") ?? "0") || 0,
      openedAt: normaliseDate(val("openedAt")) ?? undefined,
      closedAt: normaliseDate(val("closedAt")) ?? undefined,
      value: parseFloat(val("value") ?? "0") || undefined,
    });
  }
  return out;
}

// ── Active SIP Book ─────────────────────────────────────────────────────

export function parseSipBook(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalSipRow[] {
  const out: CanonicalSipRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, SIP_BOOK_ALIASES, DEFAULT_SIP_BOOK_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    // Many CRM-exported active-SIP reports carry only the scheme NAME, no code.
    // Fall back to the name as the code so the SIP row still keys + imports.
    const schemeName = val("schemeName");
    out.push({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      schemeCode: val("schemeCode") || schemeName,
      schemeName,
      amount: parseFloat(val("amount").replace(/[, ]/g, "")) || 0,
      frequency: normaliseFrequency(val("frequency")),
      sipDate: val("sipDate") || undefined,
      startDate: normaliseDate(val("startDate")) ?? undefined,
      endDate: normaliseDate(val("endDate")) ?? undefined,
      nextInstallmentAt: normaliseDate(val("nextInstallmentAt")) ?? undefined,
      mandateRefNo: val("mandateRefNo") || undefined,
    });
  }
  return out;
}

// ── NACH Mandate Status ─────────────────────────────────────────────────

export function parseMandateStatus(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalMandateRow[] {
  const out: CanonicalMandateRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, MANDATE_STATUS_ALIASES, DEFAULT_MANDATE_STATUS_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      mandateRefNo: val("mandateRefNo"),
      bankAccountMasked: val("bankAccountMasked") || undefined,
      ifsc: val("ifsc") || undefined,
      amountLimit: parseFloat(val("amountLimit") ?? "0") || undefined,
      registeredAt: normaliseDate(val("registeredAt")) ?? undefined,
      expiresAt: normaliseDate(val("expiresAt")) ?? undefined,
      status: normaliseMandateStatus(val("status")),
    });
  }
  return out;
}

// ── Monthly AUM Statement ───────────────────────────────────────────────

export function parseAumStatement(
  text: string,
  source: "cams" | "kfintech" | string
): CanonicalAumRow[] {
  const out: CanonicalAumRow[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const delim = getDelimiter(source, lines[0]);
  const { start, indexMap } = resolveHeader(lines[0] ?? "", delim, AUM_STATEMENT_ALIASES, DEFAULT_AUM_STATEMENT_MAP);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitLine(line, delim);
    const maxIdx = Math.max(...Object.values(indexMap));
    if (cols.length <= maxIdx) continue;

    const val = (field: string) => cols[indexMap[field as keyof typeof indexMap]]?.trim() ?? "";

    out.push({
      pan: val("pan"),
      folioNumber: val("folioNumber"),
      schemeCode: val("schemeCode"),
      schemeName: val("schemeName"),
      units: parseFloat(val("units") ?? "0") || 0,
      nav: parseFloat(val("nav") ?? "0") || undefined,
      aumValue: parseFloat(val("aumValue") ?? "0") || 0,
    });
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getDelimiter(_source: string, text: string): string {
  // Sniff from the header line, not the source. The upload decoder normalises
  // every spreadsheet AND csv to pipe-delimited text, so KFin uploads are pipe
  // too — keying off `source === "kfintech"` would have mis-split them.
  if (text.includes("|")) return "|";
  if (text.includes("\t")) return "\t";
  return ",";
}

/**
 * Decide whether the first line is a header and build the column map.
 * A real header is detected when alias-matching actually finds a key column
 * (folio / PAN / mandate ref) — far more robust than literal keyword sniffing,
 * which failed on CAMS files that don't print the words "PAN"/"AUM"/"BROKERAGE".
 * Falls back to the positional default map when no header is recognised.
 */
function resolveHeader(
  firstLine: string,
  delim: string,
  aliases: Record<string, string[]>,
  fallback: Record<string, number>
): { start: number; indexMap: Record<string, number> } {
  const detected = buildHeaderIndexMap(splitLine(firstLine ?? "", delim), aliases);
  if (
    detected.folioNumber !== undefined ||
    detected.pan !== undefined ||
    detected.mandateRefNo !== undefined
  ) {
    return { start: 1, indexMap: detected };
  }
  return { start: 0, indexMap: fallback };
}

function splitLine(line: string, delim: string): string[] {
  if (delim === ",") {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  return line.split(delim);
}

function normaliseFrequency(freq: string): "monthly" | "quarterly" | "weekly" | "fortnightly" | "yearly" {
  const f = freq.toLowerCase();
  if (f.includes("quarter")) return "quarterly";
  if (f.includes("weekly")) return "weekly";
  if (f.includes("fortnight")) return "fortnightly";
  if (f.includes("year")) return "yearly";
  return "monthly";
}

function normaliseMandateStatus(s: string): "pending" | "active" | "expired" | "rejected" | "cancelled" {
  const status = s.toLowerCase();
  if (status.includes("active") || status.includes("approved") || status.includes("success")) return "active";
  if (status.includes("expired")) return "expired";
  if (status.includes("reject") || status.includes("fail")) return "rejected";
  if (status.includes("cancel")) return "cancelled";
  return "pending";
}

const MONTHS_MAP: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function normaliseDate(d?: string): string | null {
  if (!d) return null;
  const s = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (dmy) {
    let day = parseInt(dmy[1], 10);
    let mon = parseInt(dmy[2], 10);
    if (mon > 12 && day <= 12) [day, mon] = [mon, day]; // MM/DD feed — swap
    return `${dmy[3]}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // DD-MON-YYYY (e.g. 31-May-2026, common in CAMS AUM exports).
  const dmon = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})/);
  if (dmon) {
    const mm = MONTHS_MAP[dmon[2].toUpperCase()];
    if (mm) return `${dmon[3]}-${mm}-${dmon[1].padStart(2, "0")}`;
  }
  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
