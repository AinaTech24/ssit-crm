/**
 * The wording shown after a meeting is scheduled, given what the API reported
 * about Calendly. Kept in one place so every scheduling form says the same thing.
 * `calendly` is null when the user has not connected Calendly — then it is just
 * the plain "meeting created" notice.
 */

export type CalendlyResult =
  | { status: "booked"; eventTypeName?: string; durationMinutes?: number }
  | { status: "not_connected" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }
  | null
  | undefined;

export function meetingCreatedNotice(
  when: Date,
  calendly: CalendlyResult
): { type: "success" | "warning" | "info"; title: string; message: string } {
  const date = when.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = when.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const base = `Meeting created on ${date} at ${time}.`;
  if (!calendly) return { type: "success", title: "Meeting created", message: base };
  if (calendly.status === "not_connected") {
    return {
      type: "info",
      title: "Meeting created — Calendly not connected",
      message: `${base} It was not added to Calendly because your Calendly isn't connected yet. Connect it in Settings → My Calendly.`,
    };
  }
  if (calendly.status === "booked") {
    return { type: "success", title: "Meeting created & added to Calendly", message: `${base} It is now on your Calendly.` };
  }
  return {
    type: "warning",
    title: "Meeting created — not added to Calendly",
    message: `${base} ${calendly.reason}`,
  };
}
