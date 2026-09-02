import Link from "next/link";
import { CalendarHeart, Cake, Gift } from "lucide-react";

/**
 * Family Touchpoints — birthdays + onboarding anniversaries across all
 * family members in the next 90 days.
 *
 * Pure render — caller passes the already-loaded `members` rows. We sort
 * by month-day proximity to today (handles year wrap by mapping past dates
 * forward into the next year).
 */
export function FamilyTouchpoints({
  members,
}: {
  members: Array<{
    id: string;
    name?: string | null;
    dob?: Date | string | null;
    onboardedAt?: Date | string | null;
    familyRole?: string | null;
    segmentTag?: string | null;
  }>;
}) {
  const now = new Date();
  const horizon = 90; // days

  type Event = {
    id: string;
    kind: "birthday" | "anniversary";
    name: string;
    role: string | null;
    daysAway: number;
    eventDate: Date;
    age?: number;
    years?: number;
  };

  const events: Event[] = [];

  for (const m of members) {
    const name = m.name ?? "Member";
    if (m.dob) {
      const dob = new Date(m.dob as any);
      if (!isNaN(dob.getTime())) {
        const next = nextOccurrence(dob, now);
        const days = Math.floor((next.getTime() - now.getTime()) / 86_400_000);
        if (days >= 0 && days <= horizon) {
          const age =
            next.getFullYear() -
            dob.getFullYear() -
            (next.getMonth() < dob.getMonth() ||
            (next.getMonth() === dob.getMonth() && next.getDate() < dob.getDate())
              ? 1
              : 0);
          events.push({
            id: `${m.id}-bday`,
            kind: "birthday",
            name,
            role: m.familyRole ?? null,
            daysAway: days,
            eventDate: next,
            age,
          });
        }
      }
    }
    if (m.onboardedAt) {
      const onb = new Date(m.onboardedAt as any);
      if (!isNaN(onb.getTime())) {
        const next = nextOccurrence(onb, now);
        const days = Math.floor((next.getTime() - now.getTime()) / 86_400_000);
        if (days >= 0 && days <= horizon) {
          const years = next.getFullYear() - onb.getFullYear();
          if (years >= 1) {
            events.push({
              id: `${m.id}-anniv`,
              kind: "anniversary",
              name,
              role: m.familyRole ?? null,
              daysAway: days,
              eventDate: next,
              years,
            });
          }
        }
      }
    }
  }

  events.sort((a, b) => a.daysAway - b.daysAway);

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
            <CalendarHeart className="size-3.5 text-rose-600" />
          </div>
          Family touchpoints (next 90 days)
        </h2>
        <span className="text-xs text-muted-foreground">Birthdays · anniversaries</span>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No birthdays or anniversaries in the next 90 days.
          <br />
          <span className="text-[11px] italic">
            Add DOB / onboarding date to each member to surface these.
          </span>
        </p>
      ) : (
        <ul className="divide-y">
          {events.slice(0, 12).map((e) => {
            const tone =
              e.daysAway <= 7
                ? "rose"
                : e.daysAway <= 30
                ? "amber"
                : "muted";
            const Icon = e.kind === "birthday" ? Cake : Gift;
            return (
              <li
                key={e.id}
                className="py-2 flex items-center justify-between text-sm"
              >
                <Link
                  href={`/dashboard/investors/${e.id.split("-")[0]}`}
                  className="flex items-center gap-2 hover:underline min-w-0 flex-1"
                >
                  <Icon
                    className={`size-3.5 flex-shrink-0 ${
                      e.kind === "birthday" ? "text-rose-600" : "text-emerald-600"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {e.kind === "birthday"
                        ? `Turning ${e.age}`
                        : `${e.years}-year anniversary`}
                      {e.role && (
                        <span className="ml-1.5 capitalize">· {e.role}</span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="text-right flex-shrink-0">
                  <div
                    className={`text-xs font-bold tabular-nums ${
                      tone === "rose"
                        ? "text-rose-600"
                        : tone === "amber"
                        ? "text-amber-700"
                        : "text-muted-foreground"
                    }`}
                  >
                    {e.daysAway === 0
                      ? "today"
                      : e.daysAway === 1
                      ? "tomorrow"
                      : `in ${e.daysAway}d`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {e.eventDate.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </div>
                </div>
              </li>
            );
          })}
          {events.length > 12 && (
            <li className="py-2 text-[11px] text-muted-foreground italic text-center">
              + {events.length - 12} more in the horizon
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Given a "calendar event" date in the past, return the next occurrence
 * (same month-day) on or after `now`. Handles year wrap so an event
 * already past in the current year resolves to next year.
 */
function nextOccurrence(eventDate: Date, now: Date): Date {
  const candidate = new Date(
    now.getFullYear(),
    eventDate.getMonth(),
    eventDate.getDate()
  );
  if (candidate.getTime() < now.setHours(0, 0, 0, 0)) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }
  return candidate;
}
