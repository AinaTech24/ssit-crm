import { describe, expect, it } from "vitest";
import { bookOnCalendly, resolveCalendlyConfig, type CalendlyConfig } from "@/lib/integrations/calendly";
import { meetingCreatedNotice } from "@/lib/integrations/calendly-notice";

type Call = { url: string; method: string; body: any };

/** A fake fetch that answers from a route table and records what was sent. */
function fakeFetch(routes: Record<string, { status: number; json: any }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: any) => {
    const path = String(url).replace("https://api.calendly.com", "");
    calls.push({ url: path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    const r = key ? routes[key] : { status: 404, json: {} };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const cfg: CalendlyConfig = {
  token: "tok",
  schedulingUrl: "https://calendly.com/palak-equitywala/30min",
  eventTypeUri: "https://api.calendly.com/event_types/ET1",
  eventTypeName: "30 Minute Meeting",
  durationMinutes: 30,
};

describe("resolveCalendlyConfig", () => {
  it("finds the event type behind the pasted booking link", async () => {
    const { fn } = fakeFetch({
      "/users/me": { status: 200, json: { resource: { uri: "https://api.calendly.com/users/U1", name: "Palak", email: "p@x.com" } } },
      "/event_types": {
        status: 200,
        json: {
          collection: [
            { uri: "ET0", name: "15 min", duration: 15, scheduling_url: "https://calendly.com/palak-equitywala/15min" },
            { uri: "ET1", name: "30 Minute Meeting", duration: 30, scheduling_url: "https://calendly.com/palak-equitywala/30min" },
          ],
        },
      },
    });
    const r = await resolveCalendlyConfig("tok", "calendly.com/palak-equitywala/30min/?utm=1", fn);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.eventTypeUri).toBe("ET1");
      expect(r.config.durationMinutes).toBe(30);
    }
  });

  it("rejects a link that is not one of the account's event types", async () => {
    const { fn } = fakeFetch({
      "/users/me": { status: 200, json: { resource: { uri: "U1" } } },
      "/event_types": { status: 200, json: { collection: [{ uri: "ET0", scheduling_url: "https://calendly.com/a/15min" }] } },
    });
    const r = await resolveCalendlyConfig("tok", "https://calendly.com/palak-equitywala/30min", fn);
    expect(r.ok).toBe(false);
  });

  it("reports a bad token", async () => {
    const { fn } = fakeFetch({ "/users/me": { status: 401, json: { title: "Unauthenticated" } } });
    const r = await resolveCalendlyConfig("bad", "https://calendly.com/a/b", fn);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/token/i);
  });
});

describe("bookOnCalendly", () => {
  const startsAt = new Date("2026-11-03T10:30:00.000Z");

  it("books the invitee on the event type at the meeting time (UTC)", async () => {
    const { fn, calls } = fakeFetch({ "/invitees": { status: 201, json: { resource: { uri: "INV1" } } } });
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "Asha", inviteeEmail: "asha@x.com" }, fn);
    expect(out.status).toBe("booked");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({
      event_type: cfg.eventTypeUri,
      start_time: "2026-11-03T10:30:00.000Z",
      invitee: { name: "Asha", email: "asha@x.com", timezone: "Asia/Kolkata" },
    });
  });

  it("does not call Calendly when the invitee has no email", async () => {
    const { fn, calls } = fakeFetch({});
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "Asha", inviteeEmail: " " }, fn);
    expect(out.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("returns Calendly's refusal instead of throwing", async () => {
    const { fn } = fakeFetch({
      "/invitees": { status: 400, json: { title: "Invalid Argument", message: "The supplied start_time is not available" } },
    });
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out).toMatchObject({ status: "failed" });
    if (out.status === "failed") expect(out.reason).toMatch(/not available/);
  });

  it("explains a plan restriction", async () => {
    const { fn } = fakeFetch({ "/invitees": { status: 403, json: { message: "Please upgrade" } } });
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    if (out.status === "failed") expect(out.reason).toMatch(/paid Calendly plan/);
    else throw new Error("expected failed");
  });

  it("survives a network error", async () => {
    const fn = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out.status).toBe("failed");
  });
});

describe("meetingCreatedNotice", () => {
  const when = new Date("2026-11-03T10:30:00.000Z");
  it("is a plain success when Calendly is not connected", () => {
    const n = meetingCreatedNotice(when, null);
    expect(n.type).toBe("success");
    expect(n.title).toBe("Meeting created");
  });
  it("confirms the Calendly booking", () => {
    expect(meetingCreatedNotice(when, { status: "booked" }).title).toMatch(/added to Calendly/);
  });
  it("warns, with the reason, when Calendly did not take it", () => {
    const n = meetingCreatedNotice(when, { status: "failed", reason: "slot taken" });
    expect(n.type).toBe("warning");
    expect(n.message).toMatch(/slot taken/);
  });
});
