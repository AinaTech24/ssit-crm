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
 *   - it needs a Calendly plan that includes API access.
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
    return `Calendly refused this request${detail ? ` (${detail})` : ""} — booking through the API needs a paid Calendly plan.`;
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

/**
 * Book `startsAt` on the host's event type, with the client/lead as the invitee.
 * Never throws — a Calendly problem must not undo a saved CRM meeting.
 */
export async function bookOnCalendly(
  config: CalendlyConfig,
  input: { startsAt: Date; inviteeName: string; inviteeEmail: string | null | undefined; timezone?: string },
  fetchFn: FetchFn = fetch
): Promise<CalendlyOutcome> {
  const email = (input.inviteeEmail ?? "").trim();
  if (!email) {
    return { status: "skipped", reason: `${input.inviteeName || "The client"} has no email on file — Calendly needs one to book.` };
  }
  try {
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
