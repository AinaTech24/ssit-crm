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
  // A time a few days ahead, on the half hour (the CRM refuses to book the past).
  const startsAt = new Date(Math.ceil((Date.now() + 3 * 86_400_000) / 1_800_000) * 1_800_000);
  const iso = startsAt.toISOString();
  const openSlot = { status: 200, json: { collection: [{ status: "available", start_time: iso }] } };
  const noLocation = { status: 200, json: { resource: { locations: [] } } };
  const routes = (extra: Record<string, { status: number; json: any }> = {}) => ({
    "/event_type_available_times": openSlot,
    "/event_types/ET1": noLocation,
    ...extra,
  });
  const posted = (calls: Call[]) => calls.filter((c) => c.method === "POST");

  it("books the invitee on the event type at the meeting time (UTC)", async () => {
    const { fn, calls } = fakeFetch(routes({ "/invitees": { status: 201, json: { resource: { uri: "INV1" } } } }));
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "Asha", inviteeEmail: "asha@x.com" }, fn);
    expect(out.status).toBe("booked");
    expect(posted(calls)).toHaveLength(1);
    expect(posted(calls)[0].body).toEqual({
      event_type: cfg.eventTypeUri,
      start_time: iso,
      invitee: { name: "Asha", email: "asha@x.com", timezone: "Asia/Kolkata" },
    });
  });

  it("does not call Calendly when the invitee has no email", async () => {
    const { fn, calls } = fakeFetch({});
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "Asha", inviteeEmail: " " }, fn);
    expect(out.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("does not try to book a time that has already passed", async () => {
    const { fn, calls } = fakeFetch({});
    const out = await bookOnCalendly(cfg, { startsAt: new Date(Date.now() - 3_600_000), inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("says the time is not open (and what is) instead of attempting a booking that would be refused", async () => {
    const other = new Date(startsAt.getTime() + 3_600_000).toISOString();
    const { fn, calls } = fakeFetch(
      routes({ "/event_type_available_times": { status: 200, json: { collection: [{ status: "available", start_time: other }] } } })
    );
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out.status).toBe("skipped");
    if (out.status === "skipped") expect(out.reason).toMatch(/not open on your Calendly/);
    expect(posted(calls)).toHaveLength(0);
  });

  it("sends the client's number when the event is a phone call that needs the invitee's number", async () => {
    const { fn, calls } = fakeFetch(
      routes({
        "/event_types/ET1": { status: 200, json: { resource: { locations: [{ kind: "outbound_call" }] } } },
        "/invitees": { status: 201, json: {} },
      })
    );
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com", inviteePhone: "98765 43210" }, fn);
    expect(out.status).toBe("booked");
    expect(posted(calls)[0].body.location).toEqual({ kind: "outbound_call", location: "+919876543210" });
  });

  it("explains when a phone-call event needs a number the client does not have", async () => {
    const { fn, calls } = fakeFetch(
      routes({ "/event_types/ET1": { status: 200, json: { resource: { locations: [{ kind: "outbound_call" }] } } } })
    );
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out.status).toBe("skipped");
    expect(posted(calls)).toHaveLength(0);
  });

  it("still tries the booking when the open-times question itself cannot be answered", async () => {
    const { fn, calls } = fakeFetch({ "/invitees": { status: 201, json: {} } });
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out.status).toBe("booked");
    expect(posted(calls)).toHaveLength(1);
  });

  it("returns Calendly's refusal instead of throwing", async () => {
    const { fn } = fakeFetch(
      routes({ "/invitees": { status: 400, json: { title: "Invalid Argument", message: "The supplied start_time is not available" } } })
    );
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    expect(out).toMatchObject({ status: "failed" });
    if (out.status === "failed") expect(out.reason).toMatch(/not available/);
  });

  it("passes on Calendly's own reason for a refusal, without claiming a paid plan is needed", async () => {
    const { fn } = fakeFetch(routes({ "/invitees": { status: 403, json: { message: "Please upgrade" } } }));
    const out = await bookOnCalendly(cfg, { startsAt, inviteeName: "A", inviteeEmail: "a@x.com" }, fn);
    if (out.status !== "failed") throw new Error("expected failed");
    expect(out.reason).toContain("Please upgrade");
    expect(out.reason).not.toMatch(/paid/i);
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
  it("is a plain success when the API says nothing about Calendly", () => {
    const n = meetingCreatedNotice(when, null);
    expect(n.type).toBe("success");
    expect(n.title).toBe("Meeting created");
  });
  it("says so when the scheduler has not connected Calendly", () => {
    const n = meetingCreatedNotice(when, { status: "not_connected" });
    expect(n.type).toBe("info");
    expect(n.message).toMatch(/My Calendly/);
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
