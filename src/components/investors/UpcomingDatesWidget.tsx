import Link from "next/link";
import { Cake, Heart, CalendarHeart } from "lucide-react";

type UpcomingDate = {
  id: string;
  name: string;
  type: "birthday" | "anniversary";
  date: string;
  days: number;
};

function relativeChip(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
}

export function UpcomingDatesWidget({ items }: { items: UpcomingDate[] }) {
  const sorted = [...(items ?? [])]
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);

  if (sorted.length === 0) return null;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="size-7 rounded-lg bg-rose-50 grid place-items-center">
          <CalendarHeart className="size-3.5 text-rose-700" />
        </div>
        <h2 className="font-semibold">Upcoming birthdays &amp; anniversaries</h2>
      </div>

      <ul className="space-y-2">
        {sorted.map((item) => {
          const isToday = item.days <= 0;
          const Icon = item.type === "birthday" ? Cake : Heart;
          return (
            <li
              key={`${item.id}-${item.type}`}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`size-7 rounded-full border grid place-items-center shrink-0 ${
                    item.type === "birthday"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }`}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/investors/${item.id}`}
                    className="text-sm font-medium text-foreground/90 hover:underline truncate block"
                  >
                    {item.name}
                  </Link>
                  <span className="text-[11px] text-muted-foreground capitalize">
                    {item.type}
                  </span>
                </div>
              </div>
              <span
                className={`chip text-[10px] font-bold border whitespace-nowrap ${
                  isToday
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {relativeChip(item.days)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
