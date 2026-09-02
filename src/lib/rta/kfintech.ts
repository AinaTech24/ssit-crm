/**
 * Kfintech (formerly Karvy) mailback parser.
 *
 * Supports the MFSD211 "Folio / Investor Master" report — a comma-CSV with a
 * header row and ~121 columns, one row per (Fund × Folio × Product/scheme).
 * We group rows by (Fund, Folio) into one `RtaFolioRecord` carrying the full
 * investor KYC + bank + nominee master and the list of schemes in that folio.
 *
 * MFSD211 is a MASTER feed — it has no units / NAV / valuation, so `schemes`
 * here carry code + name only (holdings come from a valuation report).
 */

import type { RtaFolioRecord, RtaInvestor, RtaNominee, InvestorCategory, Residency } from "./types";

/** Columns that uniquely identify an MFSD211 folio-master file. */
const SIGNATURE = ["product code", "fund", "folio", "investor name", "pan number"];

export function isKfintechFolioMaster(header: string[]): boolean {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return SIGNATURE.every((h) => have.has(h));
}

/** "DD/MM/YYYY" → "YYYY-MM-DD" (or null on anything unparseable). */
export function dmyToIso(s?: string): string | null {
  const v = (s ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  const y = m[3];
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1900 || +y > 2100) return null;
  return `${y}-${mo}-${d}`;
}

/** Words that begin the scheme part of a fund description — everything before
 *  the first of these is (heuristically) the AMC name. */
const SCHEME_WORDS = new Set([
  "balanced", "focused", "dynamic", "arbitrage", "aggressive", "value", "business",
  "bond", "equity", "hybrid", "advantage", "liquid", "debt", "gilt", "index",
  "large", "mid", "small", "multi", "flexi", "elss", "tax", "savings", "overnight",
  "ultra", "short", "medium", "long", "corporate", "credit", "banking", "psu",
  "money", "fund", "scheme", "growth", "regular", "direct", "plan", "income",
  "contra", "dividend", "idcw", "nifty", "sensex", "gold", "silver", "retirement",
  "children", "pharma", "infrastructure", "technology", "consumption", "momentum",
  "quality", "low", "sectoral", "thematic", "international", "global", "emerging",
]);

/** Best-effort AMC name from a scheme description (no AMC-name column exists). */
export function amcNameFromDescription(desc: string): string {
  const words = desc.trim().split(/\s+/).filter(Boolean);
  const take: string[] = [];
  for (const w of words) {
    if (SCHEME_WORDS.has(w.toLowerCase().replace(/[^a-z]/gi, ""))) break;
    take.push(w);
    if (take.length >= 3) break;
  }
  const name = (take.length ? take : words.slice(0, 2)).join(" ").trim();
  return name || desc.trim() || "Unknown AMC";
}

function mapCategory(statusDesc: string): InvestorCategory {
  const s = statusDesc.toUpperCase();
  if (s.includes("HINDU") || s === "HUF") return "huf";
  if (s.includes("MINOR")) return "minor";
  if (s.includes("NRI")) return "nri";
  if (s.includes("INDIVIDUAL")) return "individual";
  if (s.includes("TRUST")) return "trust";
  if (s.includes("COMPANY") || s.includes("CORPORATE") || s.includes("LTD") || s.includes("PVT")) return "company";
  return "individual";
}

function mapResidency(categoryDesc: string, statusDesc: string): Residency | null {
  const s = `${categoryDesc} ${statusDesc}`.toUpperCase();
  if (s.includes("NRI")) return "nri";
  if (s.includes("RESIDENT")) return "indian_resident";
  return null;
}

/** Keep only the last 4 digits of a bank account number. */
export function maskAccount(s?: string): string | undefined {
  const v = (s ?? "").replace(/\s+/g, "");
  if (!v) return undefined;
  return v.length <= 4 ? v : `••••${v.slice(-4)}`;
}

export function pct(s?: string): number | undefined {
  const v = (s ?? "").trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseKfintechFolioMaster(rows: string[][]): {
  reportType: string;
  folios: RtaFolioRecord[];
  missingPan: number;
  warnings: string[];
} {
  const header = rows[0].map((h) => h.trim());
  const H: Record<string, number> = {};
  header.forEach((h, i) => (H[h.toLowerCase()] = i));
  const warnings: string[] = [];
  const col = (name: string) => (name.toLowerCase() in H ? H[name.toLowerCase()] : -1);

  const C = {
    productCode: col("Product Code"),
    isin: col("ISIN"),
    fund: col("Fund"),
    folio: col("Folio"),
    fundDesc: col("Fund Description"),
    name: col("Investor Name"),
    joint1: col("Joint Name 1"),
    joint2: col("Joint Name 2"),
    addr1: col("Address #1"),
    addr2: col("Address #2"),
    addr3: col("Address #3"),
    city: col("City"),
    pincode: col("Pincode"),
    state: col("State"),
    country: col("Country"),
    dob: col("Date of Birth"),
    taxStatus: col("Tax Status"),
    email: col("Email"),
    bankAccno: col("BankAccno"),
    bankName: col("Bank Name"),
    accType: col("Account Type"),
    ifsc: col("IFSC Code"),
    broker: col("Broker Code"),
    reportDate: col("Report Date"),
    pan: col("PAN Number"),
    mobile: col("Mobile Number"),
    occupation: col("Occupation Description"),
    modeOfHolding: col("Mode of Holding Description"),
    categoryDesc: col("CategoryDesc"),
    statusDesc: col("StatusDesc"),
    kyc1: col("Kyc1Flag"),
    lastUpdated: col("LastUpdatedDate"),
    ckyc: col("CKYC NO"),
    nominee: col("Nominee"),
    nominee2: col("Nominee2"),
    nominee3: col("Nominee3"),
    nomRel: col("Nominee Relation"),
    nom2Rel: col("Nominee2 Relation"),
    nom3Rel: col("Nominee3 Relation"),
    nomRatio: col("Nominee Ratio"),
    nom2Ratio: col("Nominee2 Ratio"),
    nom3Ratio: col("Nominee3 Ratio"),
    nomDob: col("Nominee DOB"),
    guardName: col("GuardianName"),
    guardPan: col("GuardPanNo"),
  };

  const groups = new Map<string, RtaFolioRecord>();
  let missingPan = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

    const fund = get(C.fund);
    const folio = get(C.folio);
    if (!fund || !folio) continue;

    const key = `${fund}::${folio}`;
    let rec = groups.get(key);

    if (!rec) {
      const pan = get(C.pan).toUpperCase() || null;
      if (!pan) missingPan++;

      const nominees: RtaNominee[] = [];
      const addNom = (n: number, rel: number, ratio: number, dob?: number) => {
        const name = get(n);
        if (name) nominees.push({ name, relation: get(rel) || undefined, sharePct: pct(get(ratio)), dob: dob != null ? dmyToIso(get(dob)) : null });
      };
      addNom(C.nominee, C.nomRel, C.nomRatio, C.nomDob);
      addNom(C.nominee2, C.nom2Rel, C.nom2Ratio);
      addNom(C.nominee3, C.nom3Rel, C.nom3Ratio);

      const jointNames = [get(C.joint1), get(C.joint2)].filter(Boolean);
      const line1 = [get(C.addr1), get(C.addr2), get(C.addr3)].filter(Boolean).join(", ");

      const cat = mapCategory(get(C.statusDesc));
      const investor: RtaInvestor = {
        pan,
        name: get(C.name),
        nameAsPerPan: get(C.name) || undefined,
        dob: dmyToIso(get(C.dob)),
        email: get(C.email) || null,
        mobile: get(C.mobile) || null,
        occupation: get(C.occupation) || null,
        category: cat,
        residency: mapResidency(get(C.categoryDesc), get(C.statusDesc)),
        isMinor: cat === "minor",
        guardianPan: get(C.guardPan).toUpperCase() || null,
        guardianName: get(C.guardName) || null,
        kycVerified: get(C.kyc1).toUpperCase() === "Y",
        ckycNumber: get(C.ckyc) || null,
        taxStatus: get(C.taxStatus) || null,
        modeOfHolding: get(C.modeOfHolding) || null,
        jointNames: jointNames.length ? jointNames : undefined,
        address: {
          line1: line1 || undefined,
          city: get(C.city) || undefined,
          state: get(C.state) || undefined,
          pincode: get(C.pincode) || undefined,
          country: get(C.country) || undefined,
        },
      };

      rec = {
        rta: "kfintech",
        amcCode: fund,
        amcName: amcNameFromDescription(get(C.fundDesc)),
        folioNumber: folio,
        schemes: [],
        investor,
        nominees,
        bank: {
          bankName: get(C.bankName) || undefined,
          accountMasked: maskAccount(get(C.bankAccno)),
          ifsc: get(C.ifsc) || undefined,
          accountType: get(C.accType) || undefined,
        },
        brokerCode: get(C.broker) || undefined,
        reportDate: dmyToIso(get(C.reportDate)),
        lastUpdatedDate: dmyToIso(get(C.lastUpdated)),
      };
      groups.set(key, rec);
    }

    const productCode = get(C.productCode);
    if (productCode && !rec.schemes.some((s) => s.schemeCode === productCode)) {
      rec.schemes.push({ schemeCode: productCode, schemeName: get(C.fundDesc), isin: get(C.isin).toUpperCase() || undefined });
    }
  }

  const folios = [...groups.values()];
  canonicalizeAmcNames(folios);
  return { reportType: "MFSD211", folios, missingPan, warnings };
}

/** "1,234.56" → 1234.56 (0 on blank/garbage). */
export function num(s?: string): number {
  const v = (s ?? "").replace(/,/g, "").trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The per-scheme heuristic yields several AMC-name variants for one fund code
 * (e.g. fund 102 → "LIC MF" / "IDBI", since LIC absorbed IDBI MF). Collapse to
 * ONE canonical name per fund code by majority vote (ties → shortest). Mutates.
 */
export function canonicalizeAmcNames(folios: RtaFolioRecord[]): void {
  const counts = new Map<string, Map<string, number>>();
  for (const f of folios) {
    const m = counts.get(f.amcCode) ?? new Map<string, number>();
    m.set(f.amcName, (m.get(f.amcName) ?? 0) + 1);
    counts.set(f.amcCode, m);
  }
  const canonical = new Map<string, string>();
  for (const [code, names] of counts) {
    let best = "";
    let bestN = -1;
    for (const [name, n] of names) {
      if (n > bestN || (n === bestN && name.length < best.length)) {
        best = name;
        bestN = n;
      }
    }
    canonical.set(code, best);
  }
  for (const f of folios) f.amcName = canonical.get(f.amcCode) ?? f.amcName;
}

/* ─────────────────── MFSD203 — Holdings / Valuation ─────────────────── */

/** Columns that uniquely identify an MFSD203 holdings file. */
const HOLDINGS_SIGNATURE = ["product code", "folio number", "balance", "nav", "aum"];

export function isKfintechHoldings(header: string[]): boolean {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return HOLDINGS_SIGNATURE.every((h) => have.has(h));
}

export function parseKfintechHoldings(rows: string[][]): {
  reportType: string;
  folios: RtaFolioRecord[];
  missingPan: number;
  warnings: string[];
} {
  const header = rows[0].map((h) => h.trim());
  const H: Record<string, number> = {};
  header.forEach((h, i) => (H[h.toLowerCase()] = i));
  const col = (name: string) => (name.toLowerCase() in H ? H[name.toLowerCase()] : -1);

  const C = {
    productCode: col("Product Code"),
    fund: col("Fund"),
    folio: col("Folio Number"),
    fundDesc: col("Fund Description"),
    balance: col("Balance"),
    txnDate: col("Transaction Date"),
    broker: col("Broker Code"),
    name: col("Investor Name"),
    addr1: col("Address #1"),
    addr2: col("Address #2"),
    addr3: col("Address #3"),
    city: col("City"),
    pincode: col("Pincode"),
    phone: col("Phone Residence"),
    email: col("Email"),
    aum: col("AUM"),
    nav: col("NAV"),
    reportDate: col("Report Date"),
    pan: col("PAN"),
    mobile: col("Mobile No"),
  };

  const groups = new Map<string, RtaFolioRecord & { _maxTxn: string | null }>();
  let missingPan = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;
    const get = (i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");

    const fund = get(C.fund);
    const folio = get(C.folio);
    if (!fund || !folio) continue;
    const key = `${fund}::${folio}`;

    let rec = groups.get(key);
    if (!rec) {
      const pan = get(C.pan).toUpperCase() || null;
      if (!pan) missingPan++;
      const line1 = [get(C.addr1), get(C.addr2), get(C.addr3)].filter(Boolean).join(", ");
      rec = {
        rta: "kfintech",
        amcCode: fund,
        amcName: amcNameFromDescription(get(C.fundDesc)),
        folioNumber: folio,
        schemes: [],
        investor: {
          pan,
          name: get(C.name),
          email: get(C.email) || null,
          mobile: get(C.mobile) || null,
          category: "individual",
          address: {
            line1: line1 || undefined,
            city: get(C.city) || undefined,
            pincode: get(C.pincode) || undefined,
          },
        },
        nominees: [],
        bank: {},
        aum: 0,
        lastTransactionAt: null,
        brokerCode: get(C.broker) || undefined,
        reportDate: dmyToIso(get(C.reportDate)),
        _maxTxn: null,
      };
      groups.set(key, rec);
    }

    const productCode = get(C.productCode);
    const value = num(get(C.aum));
    if (productCode && !rec.schemes.some((s) => s.schemeCode === productCode)) {
      rec.schemes.push({
        schemeCode: productCode,
        schemeName: get(C.fundDesc),
        units: num(get(C.balance)) || undefined,
        nav: num(get(C.nav)) || undefined,
        value: value || undefined,
      });
      rec.aum = (rec.aum ?? 0) + value;
    }
    const txn = dmyToIso(get(C.txnDate));
    if (txn && (!rec._maxTxn || txn > rec._maxTxn)) rec._maxTxn = txn;
  }

  const folios = [...groups.values()].map(({ _maxTxn, ...rec }) => {
    rec.lastTransactionAt = _maxTxn;
    return rec as RtaFolioRecord;
  });
  canonicalizeAmcNames(folios);
  return { reportType: "MFSD203", folios, missingPan, warnings: [] };
}
