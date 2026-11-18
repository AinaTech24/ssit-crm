import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { renderProposalReportPdf, riskIndex } from "@/lib/proposal/report-pdf";
import { analyseSeries, type NavPoint } from "@/lib/proposal/report-analytics";

const DAY = 86_400_000;
const series = (start: number, days: number, annual: number): NavPoint[] =>
  Array.from({ length: days + 1 }, (_, i) => ({ t: start + i * DAY, nav: 10 * Math.pow(1 + annual, i / 365) }));

const brand = {
  displayName: "Equitywala",
  legalName: "SSIT FINSERV PRIVATE LIMITED",
  arn: "268616",
  phone: "9978903646",
  email: "chirag@equitywala.com",
  website: "www.equitywala.com",
  address: { line1: "901, Imperial Heights", line2: "Near Akshar Chowk", city: "Vadodara", pincode: "390012" },
  primaryColor: "#841f21",
};

const proposal = {
  title: "SIP plan",
  proposalNumber: "PROP-2026-0001",
  recipientName: "abc",
  riskRating: "Very High",
  products: [
    { kind: "mf", schemeName: "WhiteOak Capital Large Cap Fund Reg Gr", amcName: "WhiteOak Capital MF", schemeCode: "1001", category: "Equity: Large Cap", riskRating: "Very High", monthlyAmount: 15000, sipTermYears: 3, expectedReturn: 12 },
    { kind: "mf", schemeName: "ICICI Pru Aggressive Hybrid Fund Reg Gr", amcName: "ICICI Prudential MF", schemeCode: "1002", category: "Hybrid: Aggressive", riskRating: "Very High", monthlyAmount: 5000, sipTermYears: 3, expectedReturn: 12 },
    { kind: "mf", schemeName: "Axis Short Term Fund Ret Gr", amcName: "Axis MF", schemeCode: "1003", category: "Debt: Short Duration", riskRating: "Moderate", monthlyAmount: 5000, sipTermYears: 3, expectedReturn: 12 },
  ],
} as any;

async function textOf(buf: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return { pages: pdf.numPages, text: text as string[] };
}

describe("proposal report PDF", () => {
  it("lays out the cover, particulars, schemes, what-if and allocations", async () => {
    const buf = await renderProposalReportPdf({ proposal, brand, generatedAt: "2026-11-18T10:00:00Z", analytics: new Map() });
    const { pages, text } = await textOf(buf);
    expect(pages).toBeGreaterThanOrEqual(3);
    const all = text.join("\n").replace(/\s+/g, " ");

    // cover
    // the report title is letter-spaced, so compare without spaces
    expect(text[0].replace(/\s+/g, "")).toContain("INVESTMENTANALYSIS&PERFORMANCEREPORT");
    expect(text[0]).toContain("Investment Presentation - SIP");
    expect(all).toContain("SSIT FINSERV PRIVATE LIMITED");
    expect(all).toContain("ARN-268616");
    expect(all).toContain("18-11-2026");
    expect(all).toContain("www.equitywala.com");

    // particulars + schemes (figures from the sample report)
    expect(all).toContain("Particulars");
    expect(all).toContain("Custom Expected Returns");
    expect(all).toContain("Riskometer");
    expect(all).toContain("Grand Total:");
    expect(all).toContain("9,00,000");
    expect(all).toContain("60.00");
    expect(all).toContain("20.00");

    // what-if top-up (totals invested match the sample)
    expect(all).toContain("What if scenario @ 12.00% expected return - 3 Years");
    expect(all).toContain("SIP Amount With 5% Annual Top-up");
    expect(all).toContain("9,45,750");
    expect(all).toContain("9,93,000");
    expect(all).toContain("10,41,750");

    // allocations
    expect(all).toContain("AMC Allocation:");
    expect(all).toContain("Asset Allocation:");
    expect(all).toContain("Equity Schemes");
    expect(all).toContain("Category Allocation:");

    // disclaimer page
    expect(text[pages - 1]).toContain("Disclaimer :");
    expect(text[pages - 1].replace(/\s+/g, " ")).toContain("It is not an Investment recommendation");
  });

  it("adds trailing returns and the SIP history when NAV history is available, and leaves them out when not", async () => {
    const s = series(Date.UTC(2014, 0, 1), 365 * 12, 0.12);
    const analytics = new Map([["1001", analyseSeries("1001", s)]]);
    const withIt = await textOf(await renderProposalReportPdf({ proposal, brand, analytics }));
    const joined = withIt.text.join("\n");
    expect(joined).toContain("Trailing Returns:");
    expect(joined).toContain("Growth of Rs. 10,000 Monthly SIP");
    expect(joined).toContain("XIRR");

    const without = (await textOf(await renderProposalReportPdf({ proposal, brand, analytics: new Map() }))).text.join("\n");
    expect(without).not.toContain("Trailing Returns:");
    expect(without).not.toContain("Historical Return");
  });

  it("handles a lumpsum-only plan and non-mutual-fund items", async () => {
    const p = {
      title: "Mixed",
      proposalNumber: "PROP-2",
      recipientName: "Rajesh",
      products: [
        { kind: "mf", schemeName: "Some Fund", amcName: "X MF", category: "Equity: Flexi Cap", lumpsum: 500000, sipTermYears: 5, expectedReturn: 12 },
        { kind: "insurance", policyName: "Term Cover", insurer: "LIC", policyType: "term", sumAssured: 10000000, annualPremium: 18000, termYears: 30 },
      ],
    } as any;
    const all = (await textOf(await renderProposalReportPdf({ proposal: p, brand, analytics: new Map() }))).text.join("\n");
    expect(all).toContain("Investment Presentation - Lumpsum");
    expect(all).toContain("Lumpsum Inv. Amt.");
    expect(all).toContain("Insurance:");
    expect(all).toContain("Term Cover");
    expect(all).not.toContain("What if scenario"); // no SIP
  });

  it("still renders a proposal with no products", async () => {
    const { pages, text } = await textOf(
      await renderProposalReportPdf({ proposal: { title: "Empty", proposalNumber: "P3", recipientName: "Z", products: [] } as any, brand })
    );
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text.join("\n")).toContain("No products have been added");
  });

  it("is A4 landscape, like the reference report", async () => {
    const buf = await renderProposalReportPdf({ proposal, brand, analytics: new Map() });
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const page = await pdf.getPage(1);
    const [, , w, h] = page.view;
    expect(w).toBeGreaterThan(h);
    expect(Math.round(w)).toBe(842);
  });

  it("keeps long plans flowing onto further pages with every row present", async () => {
    const many = {
      title: "Big",
      proposalNumber: "P9",
      recipientName: "Client",
      products: Array.from({ length: 30 }, (_, i) => ({
        kind: "mf",
        schemeName: `Scheme number ${i + 1} Direct Growth`,
        amcName: `AMC ${i % 5}`,
        schemeCode: `9${i}`,
        category: `Equity: Cat ${i % 7}`,
        riskRating: "High",
        monthlyAmount: 1000 + i,
        sipTermYears: 5,
        expectedReturn: 12,
      })),
    } as any;
    const { pages, text } = await textOf(await renderProposalReportPdf({ proposal: many, brand, analytics: new Map() }));
    const all = text.join(" ");
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(all).toContain("Scheme number 1 Direct Growth");
    expect(all).toContain("Scheme number 30 Direct Growth");
  });
});

describe("riskometer position", () => {
  it("maps a risk text to one of five segments", () => {
    expect(riskIndex("Conservative")).toBe(0);
    expect(riskIndex("Low")).toBe(0);
    expect(riskIndex("Low to Moderate")).toBe(1);
    expect(riskIndex("Moderate")).toBe(2);
    expect(riskIndex("Moderately High")).toBe(3);
    expect(riskIndex("Moderately Aggressive")).toBe(3);
    expect(riskIndex("Very High")).toBe(4);
    expect(riskIndex("aggressive")).toBe(4);
    expect(riskIndex("")).toBeNull();
    expect(riskIndex("something else")).toBeNull();
  });
});
