import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { v4 as uuid } from "uuid";
import { captureError } from "@/lib/observability/capture";

/**
 * Global API error handling helper.
 *
 * Masks internal database and execution errors, while safely passing
 * user-facing validation (400), auth (401), license (402), or permission (403) errors.
 * Generates a unique reference ID for any masked internal error so developers
 * can search server logs. When the middleware minted an `x-request-id`, that id
 * is reused as the reference — so the client-visible response header, the server
 * log line, and the alert all correlate to the same request.
 */
export async function handleApiError(err: unknown): Promise<NextResponse> {
  let errorId: string | null = null;
  try {
    const h = await headers();
    errorId = h.get("x-request-id");
  } catch {
    /* outside a request context (worker/test) — fall through to a fresh id */
  }
  if (!errorId) errorId = uuid();

  // Extract HTTP status if present on the error object
  const status =
    err && typeof err === "object" && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;

  const originalMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Drizzle wraps driver errors: its own message is just the SQL + params, and
  // the REASON (pg code, constraint, detail) sits on .cause. Logging only the
  // wrapper turns a precise database error into an unreadable query dump — it
  // cost real debugging time on the review-due worker and the tenant purge, so
  // unwrap it here for every route at once.
  const cause = (err as { cause?: unknown })?.cause as
    | { code?: string; message?: string; detail?: string; constraint?: string; table?: string }
    | undefined;
  const causeLine = cause
    ? ` cause=${cause.code ?? "?"} "${cause.message ?? ""}"` +
      (cause.constraint ? ` constraint=${cause.constraint}` : "") +
      (cause.table ? ` table=${cause.table}` : "") +
      (cause.detail ? ` detail="${cause.detail}"` : "")
    : "";

  // Log on the server console with the unique reference ID
  console.error(`[API Error ${errorId}] status=${status} message="${originalMessage}"${causeLine}`, stack ?? err);

  // User-facing HTTP errors (4xx) are safe to return, but we mask obvious database keywords.
  if (status >= 400 && status < 500) {
    const isPgLeak =
      originalMessage.includes("relation") ||
      originalMessage.includes("duplicate key") ||
      originalMessage.includes("violates unique constraint") ||
      originalMessage.includes("syntax error at or near") ||
      originalMessage.includes("database");

    const safeMsg = isPgLeak ? "invalid request" : originalMessage;
    return NextResponse.json({ error: safeMsg }, { status });
  }

  // Internal/DB errors (500): alert (webhook when ERROR_WEBHOOK_URL is set)
  // with the same reference ID the caller sees, then return a generic message.
  captureError("api.unhandled_500", err, { errorId });
  return NextResponse.json(
    { error: "internal", referenceId: errorId },
    { status: 500 }
  );
}
