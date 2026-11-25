/**
 * Calendly — books a CRM meeting onto a user's Calendly.
 *
 * Calendly has no "create a calendar event" call: a booking is made by adding an
 * INVITEE to one of the host's event types (POST /invitees, the Scheduling API).
 * So a CRM meeting is recorded in Calendly as the client/lead booking the host's
 * event type at the chosen time. Consequences worth knowing:
 *   - the time must be a slot that event type is actually offering (Calendly
 *     rejects anything outside the host's availability or already taken);
 *   - the length is the event type's, not the CRM meeting's;
 *   - Calendly emails the invitee its own confirmation;
 *
 * Each user connects their OWN Calendly (personal access token + booking link),
 * stored encrypted in tenant_integrations (provider "calendly", user-level row).
 */

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";

const API = "https://api.calendly.com";

export interface CalendlyConfig {
  token: string;
  /** The booking link the user pasted, e.g. https://calendly.com/palak/30min */
  schedulingUrl: string;
  /** Resolved once at connect time. */
  eventTypeUri: string;
  eventTypeName?: string;
  durationMinutes?: number;
  hostName?: string;
  hostEmail?: string;
}

export type CalendlyOutcome =
  | { status: "booked"; eventTypeName?: string; durationMinutes?: number }
  | { status: "not_connected" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

type FetchFn = typeof fetch;

async function call(
  fetchFn: FetchFn,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetchFn(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** Calendly's own wording, with the HTTP status mapped to something a person can act on. */
function explain(status: number, json: any): string {
  const detail =
    (Array.isArray(json?.details) && json.details.map((d: any) => d?.message).filter(Boolean).join("; ")) ||
    json?.message ||
    json?.title ||
    "";
  if (status === 401) return "Calendly rejected the access token — reconnect Calendly in My profile.";
  if (status === 403) {
    return `Calendly refused this request${detail ? ` (${detail})` : ""} — check the token was created in Calendly (Integrations → API & Webhooks) and reconnect.`;
  }
  if (status === 404) return "Calendly could not find that event type — reconnect Calendly in My profile.";
  if (status === 429) return "Calendly is rate-limiting requests — try again in a minute.";
  return detail || `Calendly returned an error (${status}).`;
}

/** https://calendly.com/palak/30min?x=1/ → calendly.com/palak/30min */
function normaliseLink(u: string): string {
  return u
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Validate a token + booking link and work out which event type it points at.
 * Called when a user connects; the resolved config is what gets stored.
 */
export async function resolveCalendlyConfig(
  token: string,
  schedulingUrl: string,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; config: CalendlyConfig } | { ok: false; error: string }> {
  const me = await call(fetchFn, token, "/users/me");
  if (!me.ok) return { ok: false, error: explain(me.status, me.json) };
  const user = me.json?.resource;
  if (!user?.uri) return { ok: false, error: "Calendly did not return an account for this token." };

  const wanted = normaliseLink(schedulingUrl);
  const types = await call(fetchFn, token, `/event_types?user=${encodeURIComponent(user.uri)}&active=true&count=100`);
  if (!types.ok) return { ok: false, error: explain(types.status, types.json) };
  const list: any[] = Array.isArray(types.json?.collection) ? types.json.collection : [];
  const hit = list.find((t) => normaliseLink(String(t.scheduling_url ?? "")) === wanted);
  if (!hit) {
    const known = list.map((t) => String(t.scheduling_url ?? "")).filter(Boolean);
    return {
      ok: false,
      error: known.length
        ? `That link isn't one of this Calendly account's active event types. Found: ${known.join(", ")}`
        : "This Calendly account has no active event types.",
    };
  }

  return {
    ok: true,
    config: {
      token,
      schedulingUrl: String(hit.scheduling_url),
      eventTypeUri: String(hit.uri),
      eventTypeName: hit.name ? String(hit.name) : undefined,
      durationMinutes: typeof hit.duration === "number" ? hit.duration : undefined,
      hostName: user.name ? String(user.name) : undefined,
      hostEmail: user.email ? String(user.email) : undefined,
    },
  };
}

const apiPath = (uri: string) => uri.replace(/^https?:\/\/api\.calendly\.com/i, "");

const fmtIst = (d: Date) =>
  d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** "98765 43210" / "+91 98765 43210" -> "+919876543210" (Indian mobiles); anything else with 8+ digits keeps its own digits. */
export function toE164(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (String(phone).trim().startsWith("+")) return `+${digits}`;
  return digits.length >= 10 ? `+91${digits.slice(-10)}` : null;
}

/**
 * Is `startsAt` one of the slots the event type is offering? Calendly only books an OPEN slot - one inside the
 * host's hours, past the minimum notice, and not already taken - so asking first lets us say WHY a time did not
 * book and which times are open. Returns null when the question itself could not be answered (then we just try
 * the booking and let Calendly decide).
 */
async function checkSlot(
  fetchFn: FetchFn,
  config: CalendlyConfig,
  startsAt: Date
): Promise<{ open: true } | { open: false; nearby: Date[] } | null> {
  const now = Date.now();
  const windowStart = new Date(Math.max(now + 60_000, startsAt.getTime() - 3 * 3_600_000));
  const windowEnd = new Date(Math.max(startsAt.getTime() + 3 * 3_600_000, windowStart.getTime() + 24 * 3_600_000));
  if (windowEnd.getTime() - windowStart.getTime() > 7 * 24 * 3_600_000) windowEnd.setTime(windowStart.getTime() + 7 * 24 * 3_600_000);
  const q = `/event_type_available_times?event_type=${encodeURIComponent(config.eventTypeUri)}&start_time=${encodeURIComponent(windowStart.toISOString())}&end_time=${encodeURIComponent(windowEnd.toISOString())}`;
  const r = await call(fetchFn, config.token, q);
  if (!r.ok) return null;
  const slots: Date[] = (Array.isArray(r.json?.collection) ? r.json.collection : [])
    .filter((s: any) => (s?.status ?? "available") === "available")
    .map((s: any) => new Date(String(s.start_time)))
    .filter((d: Date) => !isNaN(d.getTime()));
  if (slots.some((d) => d.getTime() === startsAt.getTime())) return { open: true };
  const nearby = slots.sort((a, b) => Math.abs(a.getTime() - startsAt.getTime()) - Math.abs(b.getTime() - startsAt.getTime())).slice(0, 3).sort((a, b) => a.getTime() - b.getTime());
  return { open: false, nearby };
}

/**
 * What Calendly wants in `location` for this event type. A phone-call event that requires the invitee's number
 * (kind outbound_call) must be given that number, an "ask the invitee" event wants some text, a video-conference
 * event wants only its kind. Read live from the event type, so changing it in Calendly needs no reconnect.
 */
async function locationFor(
  fetchFn: FetchFn,
  config: CalendlyConfig,
  input: { inviteePhone?: string | null; locationText?: string | null }
): Promise<{ location?: { kind: string; location?: string } } | { problem: string }> {
  const r = await call(fetchFn, config.token, apiPath(config.eventTypeUri));
  const et = r.json?.resource;
  const first = Array.isArray(et?.locations) ? et.locations[0] : null;
  if (!r.ok || !first?.kind) return {};
  const kind = String(first.kind);
  if (kind === "outbound_call") {
    const phone = toE164(input.inviteePhone);
    if (!phone) return { problem: "Your Calendly event is a phone call that needs the client's mobile number, and this client has none on file. Add the mobile number and try again." };
    return { location: { kind, location: phone } };
  }
  if (kind === "ask_invitee") return { location: { kind, location: (input.locationText ?? "").trim() || "To be confirmed" } };
  if (/_conference$/.test(kind)) return { location: { kind } };
  return {};
}

/**
 * Book `startsAt` on the host's event type, with the client/lead as the invitee.
 * Checks the slot is open first, and sends the location the event type asks for.
 * Never throws — a Calendly problem must not undo a saved CRM meeting.
 */
export async function bookOnCalendly(
  config: CalendlyConfig,
  input: {
    startsAt: Date;
    inviteeName: string;
    inviteeEmail: string | null | undefined;
    inviteePhone?: string | null;
    locationText?: string | null;
    timezone?: string;
  },
  fetchFn: FetchFn = fetch
): Promise<CalendlyOutcome> {
  const email = (input.inviteeEmail ?? "").trim();
  if (!email) {
    return { status: "skipped", reason: `${input.inviteeName || "The client"} has no email on file — Calendly needs one to book.` };
  }
  if (input.startsAt.getTime() < Date.now()) {
    return { status: "skipped", reason: "That time has already passed, so it was not booked on Calendly." };
  }
  try {
    const slot = await checkSlot(fetchFn, config, input.startsAt).catch(() => null);
    if (slot && !slot.open) {
      const when = fmtIst(input.startsAt);
      const options = slot.nearby.length
        ? `Open times near it: ${slot.nearby.map(fmtIst).join("; ")}. Reschedule the meeting to one of those, or change your hours / minimum notice in Calendly.`
        : "Calendly shows no open time around then - check your hours, the minimum notice and any other bookings in Calendly.";
      return { status: "skipped", reason: `${when} is not open on your Calendly (it is already booked, outside your hours, or too soon for your minimum notice). ${options}` };
    }

    const loc = await locationFor(fetchFn, config, { inviteePhone: input.inviteePhone, locationText: input.locationText });
    if ("problem" in loc) return { status: "skipped", reason: loc.problem };

    const r = await call(fetchFn, config.token, "/invitees", {
      method: "POST",
      body: {
        event_type: config.eventTypeUri,
        start_time: input.startsAt.toISOString(),
        invitee: {
          name: input.inviteeName || email,
          email,
          timezone: input.timezone ?? "Asia/Kolkata",
        },
        ...(loc.location ? { location: loc.location } : {}),
      },
    });
    if (!r.ok) return { status: "failed", reason: explain(r.status, r.json) };
    return { status: "booked", eventTypeName: config.eventTypeName, durationMinutes: config.durationMinutes };
  } catch (e: any) {
    return { status: "failed", reason: e?.name === "TimeoutError" ? "Calendly did not answer in time." : "Could not reach Calendly." };
  }
}

// ── stored config (per user) ────────────────────────────────────────────────

export async function getCalendlyConfig(tx: Tx, tenantId: string, userId: string): Promise<CalendlyConfig | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.userId, userId),
        eq(tenantIntegrations.provider, "calendly"),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.encryptedConfig)) as CalendlyConfig;
  } catch {
    return null;
  }
}

export async function saveCalendlyConfig(tx: Tx, tenantId: string, userId: string, config: CalendlyConfig): Promise<void> {
  const encryptedConfig = encrypt(JSON.stringify(config));
  const [existing] = await tx
    .select({ id: tenantIntegrations.id })
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.userId, userId),
        eq(tenantIntegrations.provider, "calendly")
      )
    )
    .limit(1);
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
    return;
  }
  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId,
    provider: "calendly",
    encryptedConfig,
    isActive: true,
  });
}

export async function disconnectCalendly(tx: Tx, tenantId: string, userId: string): Promise<void> {
  await tx
    .update(tenantIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.userId, userId),
        eq(tenantIntegrations.provider, "calendly")
      )
    );
}
