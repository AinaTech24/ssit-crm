/**
 * Webhook signature verification — valid signatures pass, tampered ones fail,
 * and a missing secret fails CLOSED (never open). These guard the two inbound
 * doors (Resend email events, Vartify WhatsApp).
 */

import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { emailAdapter } from "@/lib/comms/adapters/resend";

describe("Resend webhook signature", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = "test_secret_resend";
  });

  function sign(raw: string, secret: string): string {
    return `v1,${crypto.createHmac("sha256", secret).update(raw).digest("base64")}`;
  }

  it("accepts a correctly-signed payload (svix header)", () => {
    expect(
      emailAdapter.verifyWebhookSignature(body, { "svix-signature": sign(body, "test_secret_resend") })
    ).toBe(true);
  });

  it("accepts when one of multiple comma-separated signatures matches", () => {
    const sigs = `${sign(body, "old_rotated_secret")},${sign(body, "test_secret_resend")}`;
    expect(emailAdapter.verifyWebhookSignature(body, { "svix-signature": sigs })).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(
      emailAdapter.verifyWebhookSignature(body + "x", { "svix-signature": sign(body, "test_secret_resend") })
    ).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(emailAdapter.verifyWebhookSignature(body, {})).toBe(false);
  });

  it("fails CLOSED when no secret is configured", () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(
      emailAdapter.verifyWebhookSignature(body, { "svix-signature": sign(body, "anything") })
    ).toBe(false);
  });

  // Full Svix scheme: signature covers `${id}.${timestamp}.${body}` and stale
  // timestamps are rejected so a captured payload can't be replayed forever.
  function signSvix(id: string, ts: number, raw: string, secret: string): string {
    return `v1,${crypto.createHmac("sha256", secret).update(`${id}.${ts}.${raw}`).digest("base64")}`;
  }

  it("accepts a full Svix-signed payload with a fresh timestamp", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(
      emailAdapter.verifyWebhookSignature(body, {
        "svix-id": "msg_1",
        "svix-timestamp": String(ts),
        "svix-signature": signSvix("msg_1", ts, body, "test_secret_resend"),
      })
    ).toBe(true);
  });

  it("rejects a replayed (stale-timestamp) Svix payload", () => {
    const ts = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min old, outside tolerance
    expect(
      emailAdapter.verifyWebhookSignature(body, {
        "svix-id": "msg_1",
        "svix-timestamp": String(ts),
        "svix-signature": signSvix("msg_1", ts, body, "test_secret_resend"),
      })
    ).toBe(false);
  });
});
