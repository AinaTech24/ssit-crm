/**
 * Thin client for the auth endpoints we added to the Next.js backend in Phase 0:
 *   POST /api/auth/mobile-login   → { token } | { require2fa, challenge }
 *   POST /api/auth/mobile-2fa     → { token }
 *   POST /api/auth/refresh        → { token }   (Authorization: Bearer)
 *   POST /api/devices             → register push token (Phase 3)
 *
 * Every authenticated call sends the session JWT as `Authorization: Bearer`,
 * which the Edge middleware now accepts as a cookie fallback. No cookies here.
 */

import { API_BASE_URL } from "./config";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
};

/** Discriminated result of a login attempt. */
export type LoginResult =
  | { kind: "ok"; token: string; user: SessionUser }
  | { kind: "2fa"; challenge: string }
  | { kind: "error"; message: string };

async function postJson(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data } as { res: Response; data: any };
}

export async function mobileLogin(email: string, password: string): Promise<LoginResult> {
  try {
    const { res, data } = await postJson("/api/auth/mobile-login", { email, password });
    if (res.ok && data.require2fa) return { kind: "2fa", challenge: data.challenge };
    if (res.ok && data.token) return { kind: "ok", token: data.token, user: data.user };
    return { kind: "error", message: data.error ?? "Sign-in failed" };
  } catch {
    return { kind: "error", message: "Network error — check your connection" };
  }
}

export async function mobileVerify2fa(challenge: string, code: string): Promise<LoginResult> {
  try {
    const { res, data } = await postJson("/api/auth/mobile-2fa", { challenge, code });
    if (res.ok && data.token) return { kind: "ok", token: data.token, user: data.user };
    return { kind: "error", message: data.error ?? "Invalid code" };
  } catch {
    return { kind: "error", message: "Network error — check your connection" };
  }
}

/** Roll the session window forward. Returns a fresh token, or null if the
 *  session is gone (revoked/expired) — caller should sign out on null. */
export async function refreshToken(token: string): Promise<string | null> {
  try {
    const { res, data } = await postJson("/api/auth/refresh", {}, token);
    return res.ok && data.token ? data.token : null;
  } catch {
    return null;
  }
}

/** Register this device's Expo push token with the backend (POST /api/devices). */
export async function registerDevice(
  token: string,
  body: { expoPushToken: string; platform: "ios" | "android"; deviceName?: string; appVersion?: string }
): Promise<boolean> {
  try {
    const { res } = await postJson("/api/devices", body, token);
    return res.ok;
  } catch {
    return false;
  }
}

/** Drop this device on sign-out so a logged-out phone stops receiving pushes. */
export async function unregisterDevice(token: string, expoPushToken: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/devices`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ expoPushToken }),
    });
  } catch {
    // Best-effort — a failed unregister self-heals when Expo reports the token dead.
  }
}
