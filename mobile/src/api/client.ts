/**
 * Centralized API client — the ONLY way the app talks to the CRM backend.
 *
 *  - Injects `Authorization: Bearer <token>` from the session store
 *  - On 401: refreshes the token once and retries; if refresh fails, signs out
 *    (→ the router sends the user to login). A single in-flight refresh is shared
 *    so concurrent 401s don't stampede.
 *  - Normalizes errors into ApiError carrying the backend's own message + status
 *    (we surface the server's validation/permission text verbatim, never invent)
 *  - Per-request timeout via AbortController
 *
 * Same endpoints, same contracts as the web app — only the transport is here.
 */

import { API_BASE_URL } from "../config";
import { useSession } from "../state/session";
import { useConnectivity } from "../state/connectivity";
import { refreshToken } from "../api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
    public kind: "http" | "network" | "timeout" = "http"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_TIMEOUT = 20_000;

/**
 * Server asset paths (avatars, tenant logos) are stored RELATIVE
 * ("/api/upload-local/…") because the web app resolves them against its own
 * origin. React Native has no origin — a relative uri in <Image> silently
 * loads nothing — so every native render site must absolutize first.
 */
export function absUrl(path?: string | null): string | null {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Query params; undefined/null values are dropped. */
  params?: Record<string, string | number | boolean | undefined | null>;
  timeout?: number;
  /** FormData for uploads — skips JSON encoding. */
  form?: FormData;
}

let refreshInFlight: Promise<string | null> | null = null;

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  if (!params) return url;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

async function rawFetch(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? DEFAULT_TIMEOUT);
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form as any; // multipart boundary set by RN automatically
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return await fetch(buildUrl(path, opts.params), {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiRequest<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const session = useSession.getState();
  let token = session.token;

  let res: Response;
  try {
    res = await rawFetch(path, opts, token);
  } catch (e: any) {
    useConnectivity.getState().setOnline(false);
    if (e?.name === "AbortError") throw new ApiError(0, "Request timed out", undefined, "timeout");
    throw new ApiError(0, "Network error — check your connection", undefined, "network");
  }

  // 401 → refresh once + retry, else sign out.
  if (res.status === 401 && token) {
    if (!refreshInFlight) refreshInFlight = refreshToken(token).finally(() => (refreshInFlight = null));
    const fresh = await refreshInFlight;
    if (fresh) {
      await useSession.getState().setToken(fresh);
      token = fresh;
      try {
        res = await rawFetch(path, opts, token);
      } catch {
        throw new ApiError(0, "Network error — check your connection", undefined, "network");
      }
    }
    if (res.status === 401) {
      await useSession.getState().signOut();
      throw new ApiError(401, "Your session has expired. Please sign in again.");
    }
  }

  // Got an HTTP response → we're online (even a 4xx/5xx means the network is up).
  useConnectivity.getState().setOnline(true);

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T = any>(path: string, params?: RequestOptions["params"]) => apiRequest<T>(path, { method: "GET", params }),
  post: <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  put: <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  del: <T = any>(path: string, body?: unknown) => apiRequest<T>(path, { method: "DELETE", body }),
  upload: <T = any>(path: string, form: FormData) => apiRequest<T>(path, { method: "POST", form, timeout: 60_000 }),
};
