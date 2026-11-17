import { describe, expect, it } from "vitest";
import { parseNavAll } from "@/lib/finance/nav-feed";

// AMFI changed its file in 2026: Plan and Option became their own columns, which
// moved the NAV and date two places to the right. The old parser read "Direct Plan"
// as the NAV, threw every row away and left the Scheme Master (and the daily NAV
// refresh) empty. Both layouts must parse.

const NEW_FEED = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Children’s Fund - Childrens' Fund)

Axis Mutual Fund

135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;31.1190;16-Nov-2026
135763;INF846K01WS2;INF846K01WQ6;Axis Children's Fund;Direct Plan;IDCW Option;28.7204;16-Nov-2026

Close Ended Schemes(Income/Debt Oriented Schemes - Other Debt Scheme)

UTI Mutual Fund

106186;INF789F01FE9;INF789F01FF6;UTI Annual Interval Fund - I;Regular Plan;IDCW;11.0609;16-Nov-2026
999999;-;-;Suspended Fund;Regular Plan;Growth;N.A.;16-Nov-2026
`;

const OLD_FEED = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

Aditya Birla Sun Life Mutual Fund
119551;INF209K01YM2;INF209K01YN0;Aditya Birla Sun Life Flexi Cap Fund - Growth;1834.56;30-May-2026
`;

describe("AMFI NAV feed parser", () => {
  it("reads the current layout (Plan and Option columns)", () => {
    const r = parseNavAll(NEW_FEED);
    expect(r).toHaveLength(3); // the N.A. row is skipped
    expect(r[0]).toMatchObject({
      schemeCode: "135762",
      nav: 31.119,
      navDate: "2026-11-16",
      amcName: "Axis Mutual Fund",
      schemeType: "Open Ended",
    });
  });

  it("puts plan and option back into the scheme name, so each code has a distinct name", () => {
    const r = parseNavAll(NEW_FEED);
    expect(r[0].schemeName).toBe("Axis Children's Fund - Direct Plan - Growth Option");
    expect(r[1].schemeName).toBe("Axis Children's Fund - Direct Plan - IDCW Option");
  });

  it("treats AMFI's '-' as no ISIN and keeps the reinvestment ISIN separately", () => {
    const r = parseNavAll(NEW_FEED);
    expect(r[0].isin).toBe("INF846K01WO1");
    expect(r[0].isinReinvest).toBeNull();
    expect(r[1].isinReinvest).toBe("INF846K01WQ6");
  });

  it("tags each scheme with the section's structure and category", () => {
    const r = parseNavAll(NEW_FEED);
    expect(r[2]).toMatchObject({ schemeType: "Close Ended", amcName: "UTI Mutual Fund" });
    expect(r[2].schemeCategory).toBe("Income/Debt Oriented Schemes - Other Debt Scheme");
  });

  it("still reads the old layout", () => {
    const r = parseNavAll(OLD_FEED);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      schemeCode: "119551",
      schemeName: "Aditya Birla Sun Life Flexi Cap Fund - Growth",
      nav: 1834.56,
      navDate: "2026-05-30",
    });
  });

  it("reads a feed with no header row by the width of the rows", () => {
    const noHeader = NEW_FEED.split("\n").slice(1).join("\n");
    expect(parseNavAll(noHeader)).toHaveLength(3);
  });

  it("returns nothing for something that is not the feed", () => {
    expect(parseNavAll("<html>Access denied</html>")).toEqual([]);
  });
});
