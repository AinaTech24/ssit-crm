import { describe, expect, it } from "vitest";
import { istDate, meetingStart, meetingTime, meetingTimeLabel, reminderDue } from "@/lib/dhandho/schedule";
import { coerceDate, matchSpeaker, matchSpeakerDetailed, parseSheetRows } from "@/lib/dhandho/sheet";

describe("Dhandho schedule", () => {
  it("meets Mon–Fri at 10:00, Saturday at 10:30, never on Sunday", () => {
    expect(meetingTime("2026-11-02")).toEqual({ hour: 10, minute: 0 }); // Monday
    expect(meetingTime("2026-11-06")).toEqual({ hour: 10, minute: 0 }); // Friday
    expect(meetingTime("2026-11-07")).toEqual({ hour: 10, minute: 30 }); // Saturday
    expect(meetingTime("2026-11-08")).toBeNull(); // Sunday
    expect(meetingTimeLabel("2026-11-07")).toBe("10:30 am");
  });

  it("converts the IST start to the right instant", () => {
    expect(meetingStart("2026-11-02")?.toISOString()).toBe("2026-11-02T04:30:00.000Z");
    expect(meetingStart("2026-11-07")?.toISOString()).toBe("2026-11-07T05:00:00.000Z");
  });

  it("knows what date it is in India, not in UTC", () => {
    expect(istDate(new Date("2026-11-01T20:00:00Z"))).toBe("2026-11-02"); // 01:30 IST next day
    expect(istDate(new Date("2026-11-02T04:00:00Z"))).toBe("2026-11-02");
  });

  it("opens the reminder 30 min before the start and closes 30 min after", () => {
    const day = "2026-11-02"; // start 04:30Z
    expect(reminderDue(day, new Date("2026-11-02T03:59:00Z"))).toBe(false); // 9:29 IST
    expect(reminderDue(day, new Date("2026-11-02T04:00:00Z"))).toBe(true); // 9:30 IST
    expect(reminderDue(day, new Date("2026-11-02T04:55:00Z"))).toBe(true); // 10:25 IST
    expect(reminderDue(day, new Date("2026-11-02T05:01:00Z"))).toBe(false); // 10:31 IST
    expect(reminderDue("2026-11-08", new Date("2026-11-08T04:30:00Z"))).toBe(false); // Sunday
  });
});

describe("Dhandho sheet", () => {
  it("reads dates typed as text in day-first order, and Excel serials", () => {
    expect(coerceDate("05-11-2026")).toBe("2026-11-05");
    expect(coerceDate("5/11/2026")).toBe("2026-11-05");
    expect(coerceDate("2026-11-05")).toBe("2026-11-05");
    expect(coerceDate("5 Nov 2026")).toBe("2026-11-05");
    expect(coerceDate("05-Nov-26")).toBe("2026-11-05");
    expect(coerceDate(46331)).toBe("2026-11-05"); // Excel serial for 5 Nov 2026
    expect(coerceDate("31-02-2026")).toBeNull();
    expect(coerceDate("soon")).toBeNull();
  });

  it("finds the columns by header, and reports rows it cannot use", () => {
    const { rows, problems } = parseSheetRows([
      ["Date", "Speaker", "Topic"],
      ["02-11-2026", "Asha Rao", "SIP basics"],
      ["", "", ""],
      ["08-11-2026", "Bhavin", ""], // Sunday
      ["not a date", "Chirag", ""],
      ["04-11-2026", "", "no speaker"],
      ["05-11-2026", "hitesh@equitywala.com", ""],
    ]);
    expect(rows).toEqual([
      { row: 2, date: "2026-11-02", speaker: "Asha Rao", topic: "SIP basics", off: null },
      { row: 7, date: "2026-11-05", speaker: "hitesh@equitywala.com", topic: null, off: null },
    ]);
    expect(problems.map((p) => p.row)).toEqual([4, 5, 6]);
    expect(problems[0].reason).toMatch(/Sunday/);
  });

  it("works without a header row", () => {
    const { rows } = parseSheetRows([["02-11-2026", "Asha Rao"]]);
    expect(rows[0]).toMatchObject({ date: "2026-11-02", speaker: "Asha Rao" });
  });

  it("matches a speaker to a user by email or exact name, never by guess", () => {
    const users = [
      { id: "1", name: "Asha Rao", email: "asha@x.com" },
      { id: "2", name: "Hitesh Mali", email: "hitesh@equitywala.com" },
      { id: "3", name: "Asha Rao", email: "asha2@x.com" }, // same name twice
    ];
    expect(matchSpeaker("hitesh@equitywala.com", users)?.id).toBe("2");
    expect(matchSpeaker("hitesh mali", users)?.id).toBe("2");
    expect(matchSpeaker("Asha Rao", users)).toBeNull(); // ambiguous
    expect(matchSpeaker("asha@x.com", users)?.id).toBe("1");
    expect(matchSpeaker("Someone Else", users)).toBeNull();
  });
});

describe("Dhandho sheet — the firm's real format", () => {
  const sheet = [
    ["Date", "Name", "Topic"],
    ["1/11/2026", "Holiday", ""], // a Sunday
    ["2/11/2026", "Hitesh sir", "The HNI Client Connect – Personal Touch Matters"],
    ["7/11/2026", "Holiday", ""], // a Saturday
    ["9/11/2026", "no 10 AM", ""],
    ["12/11/2026", "Denis", "how to find client gap in insurance"],
    ["13/11/2026", "Priyanaka", "how to reduce communication gap"],
  ];

  it("turns Holiday and 'no 10 AM' into off days, and drops an off Sunday", () => {
    const { rows, problems } = parseSheetRows(sheet);
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.date, r.off])).toEqual([
      ["2026-11-02", null],
      ["2026-11-07", "Holiday"],
      ["2026-11-09", "no 10 AM"],
      ["2026-11-12", null],
      ["2026-11-13", null],
    ]);
    expect(rows[0].topic).toBe("The HNI Client Connect – Personal Touch Matters");
  });

  it("matches first names, ignores 'sir', and tolerates one wrong letter", () => {
    const users = [
      { id: "h", name: "Hitesh Mali", email: "hitesh@equitywala.com" },
      { id: "d", name: "Denis Vaghela", email: null },
      { id: "p", name: "Priyanka Shah", email: null },
      { id: "x", name: "Payal Kapadia", email: null },
      { id: "y", name: "Payal Mehta", email: null }, // two Payals
    ];
    expect(matchSpeakerDetailed("Hitesh sir", users)).toMatchObject({ user: { id: "h" }, how: "first name" });
    expect(matchSpeakerDetailed("Denis", users)?.user.id).toBe("d");
    expect(matchSpeakerDetailed("Priyanaka", users)).toMatchObject({ user: { id: "p" }, how: "close spelling" });
    expect(matchSpeakerDetailed("Payal", users)).toBeNull(); // ambiguous: never a guess
    expect(matchSpeakerDetailed("Noor", users)).toBeNull();
  });
});
