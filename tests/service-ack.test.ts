import { describe, it, expect } from "vitest";
import { mapAckVariables, SR_ACK_MATCHER } from "@/lib/service/ack-template";

const v = { name: "Rajesh", ticket: "SR-2026-00023", eta: "09 Nov 2026", firm: "SSIT Finserv" };

describe("service-request acknowledgement template variables", () => {
  it("fills our own template's four variables", () => {
    expect(mapAckVariables(["client.name", "sr.ticket", "sr.eta", "firm.name"], v)).toEqual({
      "client.name": "Rajesh",
      "sr.ticket": "SR-2026-00023",
      "sr.eta": "09 Nov 2026",
      "firm.name": "SSIT Finserv",
    });
  });

  it("fills a firm-authored template that names them differently", () => {
    expect(mapAckVariables(["investor.name", "ticket_no", "resolution_date", "company"], v)).toEqual({
      "investor.name": "Rajesh",
      ticket_no: "SR-2026-00023",
      resolution_date: "09 Nov 2026",
      company: "SSIT Finserv",
    });
  });

  it("leaves a variable it cannot place unset rather than guessing", () => {
    expect(mapAckVariables(["something.else"], v)).toEqual({});
  });
});

describe("which existing template counts as the acknowledgement", () => {
  it("matches ours and common firm names, not unrelated ones", () => {
    expect(SR_ACK_MATCHER.test("service_request_received Service request received")).toBe(true);
    expect(SR_ACK_MATCHER.test("ticket_ack Ticket acknowledgement")).toBe(true);
    expect(SR_ACK_MATCHER.test("sip_rejected SIP rejected")).toBe(false);
  });
});
