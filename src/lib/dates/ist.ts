/**
 * Calendar days for a firm that works in India, whatever clock the server runs on.
 * (The production containers also run with TZ=Asia/Kolkata, so server-rendered times read correctly.)
 */
const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The Indian calendar day ("YYYY-MM-DD") an instant falls on. */
export function istDay(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** One Indian calendar day as a half-open range of instants: start <= t < end. */
export function istDayBounds(day: string = istDay()): { day: string; start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00+05:30`);
  return { day, start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * The calendar day of a Date that was built from local parts (`new Date(y, m, d)`) or read from text
 * such as "5 Jan 1990". `toISOString()` would give the day before for those east of Greenwich.
 */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
