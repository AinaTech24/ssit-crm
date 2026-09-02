/**
 * RTA reverse-feed — normalized types.
 *
 * The RTAs (Kfintech, CAMS, …) each ship daily "mailback" report files in their
 * own column layout. We parse every supported report into ONE normalized shape
 * (`RtaFolioRecord`, one per folio) so the import service is RTA-agnostic. Each
 * per-RTA parser lives in its own module (kfintech.ts, cams.ts) and emits these.
 */

export type RtaSource = "kfintech" | "cams" | "unknown";

export type InvestorCategory = "individual" | "huf" | "minor" | "nri" | "company" | "trust" | "other";
export type Residency = "indian_resident" | "nri" | "oci" | "pio" | "foreign_national";

export type RtaScheme = {
  /** RTA scheme/product code, e.g. Kfintech "101BAGP". */
  schemeCode: string;
  schemeName: string;
  /** ISIN from the file (when present) — the reliable key to resolve the
   *  canonical AMFI scheme name + AMC name + AMFI scheme code. */
  isin?: string;
  category?: string;
  /** Holdings (from a valuation report like MFSD203) — absent in master feeds. */
  units?: number;
  nav?: number;
  value?: number;
};

export type RtaNominee = {
  name: string;
  relation?: string;
  /** Nomination share %, 0–100. */
  sharePct?: number;
  dob?: string | null;
};

export type RtaBank = {
  bankName?: string;
  /** Masked to the last 4 digits — we never persist a full account number. */
  accountMasked?: string;
  ifsc?: string;
  accountType?: string;
};

export type RtaInvestor = {
  /** PAN (upper-cased). null when the feed row has no PAN — such folios cannot
   *  resolve to an investor and are skipped + counted. */
  pan: string | null;
  name: string;
  nameAsPerPan?: string;
  dob?: string | null; // ISO yyyy-mm-dd
  email?: string | null;
  mobile?: string | null;
  occupation?: string | null;
  category: InvestorCategory;
  residency?: Residency | null;
  /** KYC marked done by the RTA (KRA/CKYC registered). */
  kycVerified?: boolean;
  ckycNumber?: string | null;
  taxStatus?: string | null;
  modeOfHolding?: string | null;
  jointNames?: string[];
  address?: { line1?: string; city?: string; state?: string; pincode?: string; country?: string };
  /** A minor folio is operated under a guardian (the minor has no PAN of its
   *  own). These let the importer create the minor as a SEPARATE client linked
   *  to the guardian rather than merging it into the guardian's PAN. */
  isMinor?: boolean;
  guardianPan?: string | null;
  guardianName?: string | null;
};

/** One folio (after grouping the feed's per-scheme rows by AMC + folio). */
export type RtaFolioRecord = {
  rta: "kfintech" | "cams";
  /** RTA fund/AMC code (Kfintech "Fund" col, e.g. "101", "RMF"). */
  amcCode: string;
  amcName: string;
  folioNumber: string;
  schemes: RtaScheme[];
  investor: RtaInvestor;
  nominees: RtaNominee[];
  bank: RtaBank;
  /** Folio market value (sum of scheme values) — holdings feeds only. */
  aum?: number;
  /** Latest transaction date across the folio's schemes (ISO) — holdings feeds. */
  lastTransactionAt?: string | null;
  brokerCode?: string;
  reportDate?: string | null; // ISO
  lastUpdatedDate?: string | null; // ISO
};

export type RtaParseResult = {
  source: RtaSource;
  /** master = KYC/folio master · holdings = valuations · full = both (CAMS). */
  kind: "master" | "holdings" | "full" | "unknown";
  /** Report code, e.g. "MFSD211". */
  reportType: string;
  /** Number of data rows in the file (pre-grouping). */
  totalRows: number;
  folios: RtaFolioRecord[];
  warnings: string[];
  /** Count of feed rows that had no PAN (their folios are not importable). */
  missingPan: number;
};
