/**
 * Turning a failed API response into something a human can act on.
 *
 * The server masks 500s as `{ error: "internal", referenceId }` on purpose —
 * database internals must not reach the browser. But showing the raw payload
 * puts the word "internal" on screen, which tells the user nothing and gives
 * support nothing to search. Worse, several callers simply swallowed the
 * failure, so a broken panel looked like an empty one.
 *
 * This gives every call site the same two things: a sentence worth reading, and
 * the reference id that matches the server log line.
 */

export type ApiFailure = {
  /** What to show the user. Never a raw SQL or driver message. */
  message: string;
  /** Correlates with the `[API Error <id>]` server log line, when the API sent one. */
  referenceId: string | null;
  status: number;
};

/**
 * Read a non-OK Response into an ApiFailure.
 *
 * `action` describes what was being attempted, in the imperative — "load gifts",
 * "save the budget" — so the sentence reads naturally.
 */
export async function readApiError(res: Response, action: string): Promise<ApiFailure> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; referenceId?: string }
    | null;
  const referenceId = body?.referenceId ?? null;
  const raw = body?.error;

  // 500s: the body carries no detail by design. Say so plainly and hand over
  // the reference rather than printing the literal string "internal".
  if (res.status >= 500 || raw === "internal" || !raw) {
    return {
      message: `Couldn't ${action}. Something went wrong on the server${
        referenceId ? ` (reference ${referenceId.slice(0, 8)})` : ""
      }.`,
      referenceId,
      status: res.status,
    };
  }

  // 4xx: the API's own message is user-facing and already masked.
  if (res.status === 401) return { message: "Your session has expired — sign in again.", referenceId, status: res.status };
  if (res.status === 403) return { message: `You don't have permission to ${action}.`, referenceId, status: res.status };
  if (res.status === 404) return { message: `Couldn't ${action} — it no longer exists.`, referenceId, status: res.status };

  return { message: raw, referenceId, status: res.status };
}

/**
 * The same for a thrown error (network down, request aborted), so callers have
 * one shape to handle instead of two.
 */
export function readThrownError(err: unknown, action: string): ApiFailure {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  // fetch() rejects with a terse "Failed to fetch" when the network is gone.
  const offline = /failed to fetch|networkerror|load failed/i.test(msg);
  return {
    message: offline
      ? `Couldn't ${action} — you appear to be offline.`
      : `Couldn't ${action}. ${msg || "Unexpected error."}`,
    referenceId: null,
    status: 0,
  };
}
