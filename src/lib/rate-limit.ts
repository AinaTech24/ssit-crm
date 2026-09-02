/**
 * Minimal token-bucket rate limiter.
 *
 * Storage: in-memory Map keyed by `<scope>:<identifier>` (typically
 * `<route>:<ip>`). Works on a single Node process; for multi-instance
 * deployments, swap the Map for Redis (`SETEX` + `INCR` pattern) — see
 * the comment block at the bottom. The interface is identical.
 *
 * Used to block:
 *   - credential stuffing on /api/auth/login
 *   - signup spam on /api/auth/signup
 *   - OTP enumeration on /api/auth/forgot
 *   - upload spam on /api/public/docs/submit
 *   - submission spam on /api/public/risk-profile/submit + proposals/accept
 *
 * Each route picks its own limit + window (see RATE_LIMITS below).
 *
 * On limit-exceeded the helper sets headers:
 *   X-RateLimit-Limit
 *   X-RateLimit-Remaining
 *   X-RateLimit-Reset (unix seconds)
 *   Retry-After
 */

import type { NextRequest } from "next/server";

type Bucket = {
  count: number;
  resetAt: number; // unix ms
};

const buckets = new Map<string, Bucket>();

// Periodic GC so the Map doesn't grow forever on a long-lived process.
// Run every 5 min, drop anything whose resetAt is in the past.
if (typeof globalThis !== "undefined" && !(globalThis as any).__rl_gc) {
  (globalThis as any).__rl_gc = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }, 5 * 60 * 1000);
  // Don't keep the process alive just for the GC tick.
  (globalThis as any).__rl_gc?.unref?.();
}

export type LimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetSec: number;
};

/**
 * Apply a rate-limit policy to (scope, identifier).
 *   scope:       e.g. "auth.login" — picks the policy
 *   identifier:  e.g. the visitor's IP, or "<ip>:<email>"
 *
 * Returns `{ ok: false }` if the request should be rejected.
 */
export function checkRateLimit(
  scope: string,
  identifier: string,
  policy: { limit: number; windowSec: number }
): LimitResult {
  const key = `${scope}:${identifier}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    // Fresh window
    const resetAt = now + policy.windowSec * 1000;
    buckets.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: policy.limit,
      remaining: policy.limit - 1,
      resetSec: Math.ceil(resetAt / 1000),
    };
  }

  existing.count++;
  const ok = existing.count <= policy.limit;
  return {
    ok,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - existing.count),
    resetSec: Math.ceil(existing.resetAt / 1000),
  };
}

/**
 * Pull the visitor's identifier — IP from headers, falling back to
 * a synthetic "anon" so the route always rate-limits something.
 */
export function clientIdentifier(req: NextRequest | Request): string {
  const headers = (req as any).headers as Headers;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = headers.get("x-real-ip");
  if (real) return real;
  return "anon";
}

/**
 * Convenience: enforce a rate limit on the current request. If the limit
 * is exceeded, returns a 429 Response that the handler should return as-is.
 * Otherwise returns null (= proceed).
 *
 *   const limited = enforce(req, "auth.login", { limit: 10, windowSec: 900 });
 *   if (limited) return limited;
 */
/** Build the standard 429 response from a limit result. */
function tooManyResponse(r: LimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests — please wait a bit and try again.",
      retryAfterSec: r.resetSec - Math.floor(Date.now() / 1000),
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "X-RateLimit-Limit": String(r.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(r.resetSec),
        "Retry-After": String(r.resetSec - Math.floor(Date.now() / 1000)),
      },
    }
  );
}

export function enforce(
  req: NextRequest | Request,
  scope: string,
  policy: { limit: number; windowSec: number },
  /** Optional extra suffix on the bucket key (e.g. an email address). */
  extraKey?: string
): Response | null {
  const id = clientIdentifier(req);
  const ident = extraKey ? `${id}:${extraKey}` : id;
  const r = checkRateLimit(scope, ident, policy);
  return r.ok ? null : tooManyResponse(r);
}

/**
 * Enforce a rate limit keyed by an EXPLICIT identifier (e.g. a signed-in
 * user id or tenant id) instead of the client IP. Use this for
 * authenticated, per-user/per-tenant limits — keying by IP shares one bucket
 * across every user behind a reverse proxy (they all present the proxy's IP),
 * which makes a per-user action like "resend my verification email" globally
 * throttled. Returns a 429 Response when exceeded, else null.
 *
 *   const limited = enforceKeyed("auth.verify_resend", `user:${userId}`, { limit: 5, windowSec: 3600 });
 *   if (limited) return limited;
 */
export function enforceKeyed(
  scope: string,
  identifier: string,
  policy: { limit: number; windowSec: number }
): Response | null {
  const r = checkRateLimit(scope, identifier, policy);
  return r.ok ? null : tooManyResponse(r);
}

/* --------------------------------------------------------------------------
 * Move to Redis when the deployment crosses 1 node.
 *
 * The in-memory Map above is correct for a single Node process. As soon as
 * you put two web containers behind a load balancer (Phase 1+ in
 * DEPLOYMENT.md), an attacker can round-robin between them and effectively
 * double the limit. The fix is to back the bucket in Redis:
 *
 *   await redis.eval(
 *     `local c = redis.call('INCR', KEYS[1])
 *      if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
 *      return c`,
 *     1,
 *     key,
 *     policy.windowSec
 *   );
 *
 * Or use the `@upstash/ratelimit` library which wraps that pattern.
 * The function signature here doesn't need to change — only the storage.
 * -------------------------------------------------------------------------- */
