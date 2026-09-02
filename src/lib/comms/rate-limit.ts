/**
 * Per-tenant × channel send rate limiting for the comms pipeline.
 *
 * `dispatch()` documents a rate-limit step but never enforced one — a runaway
 * workflow loop or a misconfigured campaign could fire thousands of sends a
 * minute and trip the provider's / WABA's own limits (and burn the tenant's
 * reputation). This is a lightweight token bucket that caps the burst.
 *
 * Design notes / honest limitations:
 *   - State is in-process (a module-level Map). In the BullMQ worker — where
 *     the high-volume sends actually run — that's a single long-lived process,
 *     so the cap is effective. API-route sends (1:1 Compose) are low volume and
 *     largely unaffected. It is NOT a globally-coordinated limiter across many
 *     processes; the BullMQ queue concurrency bounds the rest.
 *   - AUTHENTICATION (OTP) is never throttled — those must always go through.
 *   - Limits are generous by default so legitimate 1:1 sends never trip; they
 *     exist to catch pathological bursts. Override per-channel via env.
 */

export type RateLimitChannel = "whatsapp" | "email" | "sms";
export type RateLimitCategory = "transactional" | "utility" | "marketing" | "authentication";

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Per-minute send ceilings per tenant per channel (env-overridable). */
function limitFor(channel: RateLimitChannel): number {
  switch (channel) {
    case "email":
      return envInt("COMMS_RATE_EMAIL_PER_MIN", 300);
    case "whatsapp":
      return envInt("COMMS_RATE_WHATSAPP_PER_MIN", 120);
    case "sms":
      return envInt("COMMS_RATE_SMS_PER_MIN", 120);
  }
}

interface Bucket {
  tokens: number;
  /** ms timestamp of the last refill. */
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining tokens after this call (for diagnostics). */
  remaining: number;
  limitPerMin: number;
}

/**
 * Consume one token for (tenant, channel). Returns whether the send is allowed.
 * `now` is injectable for tests.
 */
export function consumeRateLimit(
  tenantId: string,
  channel: RateLimitChannel,
  category: RateLimitCategory,
  now: number = Date.now()
): RateLimitDecision {
  const limitPerMin = limitFor(channel);
  // OTP / authentication is exempt — never throttle a login code.
  if (category === "authentication") {
    return { allowed: true, remaining: limitPerMin, limitPerMin };
  }

  const key = `${tenantId}:${channel}`;
  const refillPerMs = limitPerMin / 60_000; // continuous refill
  const b = buckets.get(key) ?? { tokens: limitPerMin, last: now };

  // Refill proportional to elapsed time, capped at the bucket size.
  const elapsed = Math.max(0, now - b.last);
  b.tokens = Math.min(limitPerMin, b.tokens + elapsed * refillPerMs);
  b.last = now;

  let allowed = false;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    allowed = true;
  }
  buckets.set(key, b);
  return { allowed, remaining: Math.floor(b.tokens), limitPerMin };
}

/** Test/diagnostics helper — clears all buckets. */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}
