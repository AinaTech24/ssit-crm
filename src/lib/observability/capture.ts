/**
 * Pluggable structured observability. Every event is emitted as one JSON log
 * line for CloudWatch / Datadog / OpenTelemetry collectors and can also be sent
 * to an operator webhook. Best-effort and never throws.
 */

type Level = "info" | "warn" | "error";

export function captureEvent(level: Level, context: string, extra?: Record<string, unknown>): void {
  const payload = {
    service: "mfd-crm",
    env: process.env.NODE_ENV ?? "unknown",
    level,
    context,
    extra: extra ?? null,
    at: new Date().toISOString(),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);

  const url = process.env.OBSERVABILITY_WEBHOOK_URL ?? process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: line }).catch(() => {});
  } catch {
    // Observability must never break a business path.
  }
}

export function captureError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  captureEvent("error", context, {
    message,
    stack: stack?.split("\n").slice(0, 8).join("\n"),
    ...(extra ?? {}),
  });
}
