/**
 * A day's clock-in / clock-out sessions. The attendance row keeps a summary
 * (first in, last out, minutes over closed sessions) so everything that reads
 * clock_in_at / clock_out_at / total_minutes keeps working.
 */

export type Punch = { in: string; out: string | null };

type PunchRow = {
  punches?: unknown;
  clock_in_at?: string | Date | null;
  clock_out_at?: string | Date | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

/** The day's sessions, deriving one from the summary columns for rows punched before sessions existed. */
export function punchesOf(input: object | null | undefined): Punch[] {
  if (!input) return [];
  const row = input as PunchRow;
  if (Array.isArray(row.punches)) {
    return (row.punches as Punch[])
      .filter((p) => p && p.in)
      .map((p) => ({ in: iso(p.in), out: p.out ? iso(p.out) : null }));
  }
  if (row.clock_in_at) return [{ in: iso(row.clock_in_at), out: row.clock_out_at ? iso(row.clock_out_at) : null }];
  return [];
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

/** Summary columns for a set of sessions. totalMinutes counts closed sessions only. */
export function summarise(punches: Punch[]): { clockInAt: string | null; clockOutAt: string | null; totalMinutes: number | null } {
  if (punches.length === 0) return { clockInAt: null, clockOutAt: null, totalMinutes: null };
  const closed = punches.filter((p) => p.out);
  const last = punches[punches.length - 1];
  return {
    clockInAt: punches[0].in,
    clockOutAt: last.out,
    totalMinutes: closed.length ? closed.reduce((n, p) => n + minutesBetween(p.in, p.out as string), 0) : null,
  };
}

/** True while the last session is still running. */
export function isClockedIn(punches: Punch[]): boolean {
  return punches.length > 0 && punches[punches.length - 1].out == null;
}
