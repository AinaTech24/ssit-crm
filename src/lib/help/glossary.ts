/**
 * MFD jargon glossary. Plain-English explanations for terms that
 * non-technical Mutual Fund Distributors encounter throughout the app.
 *
 * `short` shows in HelpHint tooltips; `long` shows on the /dashboard/help page.
 *
 * Keep `short` <= 160 chars so the popover fits without scrolling.
 */
export type GlossaryEntry = {
  short: string;
  long?: string;
  category: "Identifiers" | "Regulatory" | "Products" | "Operations" | "Marketing";
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  ARN: {
    short:
      "AMFI Registration Number — your unique 6-digit code as an MFD. It appears on every communication you send to investors.",
    long:
      "AMFI Registration Number. Issued by the Association of Mutual Funds in India after passing the NISM-V-A exam. Renewed every 3 years. SEBI rules require ARN to appear on every piece of marketing and every report you share with clients.",
    category: "Identifiers",
  },
  EUIN: {
    short:
      "Employee Unique Identification Number — assigned to each person at your firm who advises clients. Required on every transaction form.",
    long:
      "Employee Unique Identification Number. AMFI issues an EUIN to each employee of an MFD firm who is qualified to give advice. EUIN must be quoted on every transaction so the right employee gets credit.",
    category: "Identifiers",
  },
  RIA: {
    short:
      "Registered Investment Adviser — a SEBI-registered advisor who charges fees (not commissions). Different from an MFD.",
    long:
      "Registered Investment Adviser. Regulated by SEBI under the IA Regulations 2013. RIAs charge an advisory fee directly and cannot earn commissions from AMCs. MFDs earn commissions and cannot charge advisory fees.",
    category: "Regulatory",
  },
  KYC: {
    short:
      "Know Your Customer — the one-time identity and address proof every investor must complete before transacting in mutual funds.",
    long:
      "Know Your Customer. PAN + Aadhaar + photograph + signature. Once KYC is done with any KRA (CAMS-KRA, CVL-KRA, NDML, KARVY, DotEx), the investor can transact across any AMC.",
    category: "Regulatory",
  },
  UCC: {
    short:
      "Unique Client Code — a 10-digit code assigned by BSE Star MF / NSE NMF II so you can place transactions on the exchange.",
    long:
      "Unique Client Code. Created when an investor is onboarded on BSE Star MF or NSE NMF II. Required before any online transaction can be routed through the exchange.",
    category: "Operations",
  },
  CAN: {
    short:
      "Common Account Number — issued by MF Utility (MFU) so an investor can transact across multiple AMCs from one login.",
    long:
      "Common Account Number. MFU (MF Utility) issues a CAN that consolidates folios across AMCs. Optional, but convenient for investors with holdings in many fund houses.",
    category: "Operations",
  },
  NAV: {
    short:
      "Net Asset Value — the per-unit price of a mutual fund scheme on a given day, published by 9 PM each business day.",
    long:
      "Net Asset Value. (Total assets − liabilities) ÷ units outstanding. NAV applies to a transaction based on cut-off times: 3 PM same-day NAV for equity/debt purchases up to ₹2 lakh; T+1 for above.",
    category: "Products",
  },
  AUM: {
    short:
      "Assets Under Management — the total market value of all client money you manage as an MFD.",
    long:
      "Assets Under Management. The total NAV of all units across all your investors. AUM drives your trail commission. Reported monthly by CAMS/KFintech in the brokerage statement.",
    category: "Products",
  },
  SIP: {
    short:
      "Systematic Investment Plan — a recurring monthly (or weekly/quarterly) auto-debit into a mutual fund.",
    long:
      "Systematic Investment Plan. Auto-debits a fixed amount on a set date. Rupee-cost-averages the entry price. Can be paused, stopped, or stepped-up. Top reason for MFD AUM growth.",
    category: "Products",
  },
  STP: {
    short:
      "Systematic Transfer Plan — auto-transfer a fixed amount from one mutual fund scheme to another, usually liquid → equity.",
    long:
      "Systematic Transfer Plan. Used to deploy a lump sum gradually — park in liquid, sweep into equity over 12–24 months. Smooths out market-timing risk.",
    category: "Products",
  },
  SWP: {
    short:
      "Systematic Withdrawal Plan — auto-redeem a fixed amount from a mutual fund every month, like a pension.",
    long:
      "Systematic Withdrawal Plan. Investor sells a fixed number of units (or a fixed rupee amount) at a set frequency. Tax-efficient retirement income.",
    category: "Products",
  },
  SEBI: {
    short:
      "Securities and Exchange Board of India — the regulator that supervises mutual funds, RIAs, and MFDs.",
    long:
      "Securities and Exchange Board of India. The market regulator. Issues circulars MFDs must follow: ARN disclosure, risk profiling, suitability, advertisement code, complaint handling.",
    category: "Regulatory",
  },
  AMFI: {
    short:
      "Association of Mutual Funds in India — the industry body that issues ARN and EUIN and sets the MFD code of conduct.",
    long:
      "Association of Mutual Funds in India. Self-regulatory organisation for AMCs and MFDs. Conducts NISM exam, issues ARN/EUIN, publishes industry data.",
    category: "Regulatory",
  },
  KRA: {
    short:
      "KYC Registration Agency — keeps a central record of every investor's KYC so you don't have to redo it for each AMC.",
    long:
      "KYC Registration Agency. CAMS-KRA, CVL-KRA, NDML, KARVY-KRA, DotEx. SEBI-mandated. Once KYC is uploaded to any one KRA, all KRAs (and all AMCs) can access it.",
    category: "Regulatory",
  },
  DDQ: {
    short:
      "Due Diligence Questionnaire — a checklist AMCs ask their top MFDs to fill, used in audits and re-empanelment.",
    long:
      "Due Diligence Questionnaire. Covers your firm's people, processes, compliance setup, complaint records, cybersecurity, BCP. Score 80%+ to stay empanelled with top AMCs.",
    category: "Regulatory",
  },
  NISM: {
    short:
      "National Institute of Securities Markets — the body that conducts the V-A exam every MFD must clear.",
    long:
      "National Institute of Securities Markets. A SEBI-promoted institute. The NISM-Series-V-A: Mutual Fund Distributors Certification Examination is mandatory to get an ARN.",
    category: "Regulatory",
  },
  PAN: {
    short:
      "Permanent Account Number — the 10-character income tax ID. Required for every mutual fund investment.",
    long:
      "Permanent Account Number. Issued by India's Income Tax Department. Mandatory KYC field. Mutual fund investments above ₹50,000 per transaction also need PAN cross-verification.",
    category: "Identifiers",
  },
  FATCA: {
    short:
      "Foreign Account Tax Compliance Act — a US law that requires Indian AMCs to ask investors about US tax residency.",
    long:
      "Foreign Account Tax Compliance Act. Every Indian KYC now includes a FATCA self-declaration so AMCs can report US tax-residents to the IRS via Indian authorities.",
    category: "Regulatory",
  },
  SID: {
    short: "Scheme Information Document — the official brochure of a mutual fund, listing strategy, risks, and fees.",
    category: "Products",
  },
  SAI: {
    short: "Statement of Additional Information — the legal supplement to the SID, with detailed AMC information.",
    category: "Products",
  },
  KIM: {
    short: "Key Information Memorandum — the short 4-page summary of a mutual fund scheme that goes with the application form.",
    category: "Products",
  },
  TER: {
    short:
      "Total Expense Ratio — the annual fee a mutual fund charges, expressed as a % of assets. Lower TER = more returns for the investor.",
    category: "Products",
  },
  XIRR: {
    short:
      "Extended Internal Rate of Return — the right way to measure SIP returns when contributions happen at different times.",
    category: "Products",
  },
  CAGR: {
    short:
      "Compound Annual Growth Rate — the annualised return on a lump-sum investment over multiple years.",
    category: "Products",
  },
  NRI: {
    short:
      "Non-Resident Indian — an investor who lives outside India. Different KYC + tax + repatriation rules apply.",
    category: "Identifiers",
  },
  HUF: {
    short:
      "Hindu Undivided Family — a special tax entity for joint Hindu families. Has its own PAN and can hold mutual funds.",
    category: "Identifiers",
  },
  ELSS: {
    short:
      "Equity Linked Savings Scheme — a tax-saving equity mutual fund with a 3-year lock-in, eligible for Section 80C.",
    category: "Products",
  },
  CAMS: {
    short:
      "Computer Age Management Services — the largest mutual fund registrar in India. Handles back-office for ~70% of AMCs.",
    category: "Operations",
  },
  KFintech: {
    short:
      "KFin Technologies — the other major mutual fund registrar in India (formerly Karvy). Handles ~30% of AMCs.",
    category: "Operations",
  },
  BSE: {
    short: "Bombay Stock Exchange — operates BSE Star MF, the platform you use to place mutual fund orders.",
    category: "Operations",
  },
  NSE: {
    short:
      "National Stock Exchange — operates NSE NMF II, an alternative to BSE Star MF for placing mutual fund orders.",
    category: "Operations",
  },
  MFU: {
    short:
      "MF Utility — a transaction platform owned by AMCs. Issues CAN. Lets investors transact across AMCs from one login.",
    category: "Operations",
  },
  NACH: {
    short:
      "National Automated Clearing House — the bank mandate that lets you auto-debit a SIP from an investor's account every month.",
    category: "Operations",
  },
  OTM: {
    short:
      "One-Time Mandate — a paper mandate the investor signs once, authorising future SIP debits. Replaced largely by e-NACH.",
    category: "Operations",
  },
  DLT: {
    short:
      "Distributed Ledger Technology — TRAI rule. Every SMS template must be pre-registered on a telco's DLT platform before it can be sent.",
    category: "Marketing",
  },
  RTA: {
    short:
      "Registrar and Transfer Agent — companies that maintain investor records on behalf of AMCs. In India this is mostly CAMS and KFintech.",
    long:
      "Registrar and Transfer Agent. Two registrars (CAMS ~70%, KFintech ~30%) handle the back-office for every Indian mutual fund. MFDs receive daily / weekly / monthly flat files from them (transaction feed, brokerage statement, AUM snapshot, etc.) which the CRM imports automatically.",
    category: "Operations",
  },
  WBR: {
    short:
      "Weekly Business Report — flat file from CAMS/KFintech every Monday with net business + commission accrual for the prior week.",
    category: "Operations",
  },
};
