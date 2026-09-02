"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { PERIOD_LABELS, type Period } from "@/lib/dashboard/period";
import { DatePicker } from "@/components/ui/DatePicker";

// Re-export the type for existing importers of this module.
export type { Period };

/**
 * Period selector — MTD / QTD / FYTD / Last Month.
 *
 * Purely a URL-param writer. The server OwnerCockpit reads ?period= and
 * adjusts its SQL date ranges accordingly. No client-side state beyond
 * the navigation transition.
 *
 * India FY = April–March. QTD quarters:
 *   Q1: Apr–Jun · Q2: Jul–Sep · Q3: Oct–Dec · Q4: Jan–Mar
 */
export function PeriodSelector({ current, variant = "dark" }: { current: Period; variant?: "dark" | "light" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pstart = searchParams.get("pstart") ?? "";

  // The dark variant lives inside the brown OwnerCockpit banner; the light
  // variant is for normal (light) headers like the per-user dashboard.
  const cls =
    variant === "light"
      ? { wrap: "border-border bg-card", active: "bg-primary text-primary-foreground shadow-sm", idle: "text-muted-foreground hover:text-foreground hover:bg-accent" }
      : { wrap: "border-white/20 bg-white/10 backdrop-blur-sm", active: "bg-white text-slate-900 shadow-sm", idle: "text-white/75 hover:text-white hover:bg-white/10" };

  function select(p: Period) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pstart");
    if (p === "mtd") params.delete("period");
    else params.set("period", p);
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  function selectCustom(d: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (d) { params.set("period", "custom"); params.set("pstart", d); }
    else { params.delete("period"); params.delete("pstart"); }
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  return (
    <div
      className={`inline-flex rounded-lg border p-0.5 gap-0.5 ${cls.wrap} ${
        pending ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {(Object.keys(PERIOD_LABELS) as Array<"mtd" | "qtd" | "fytd" | "lm">).map((p) => (
        <button
          key={p}
          onClick={() => select(p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
            current === p ? cls.active : cls.idle
          }`}
        >
          {p === "mtd" && <CalendarDays className="size-3" />}
          {PERIOD_LABELS[p]}
        </button>
      ))}
      {/* Custom "since" date — uses the branded DatePicker (calendar popup), not
          a native <input type=date>. The native input fired onChange on every
          partial keystroke, navigating mid-type and resetting the field; the
          DatePicker only commits a complete date on day-click, so it's stable. */}
      <div
        className={`px-2 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 ${
          current === "custom" ? cls.active : cls.idle
        }`}
        title="Custom — show everything since this date"
      >
        <CalendarDays className="size-3" />
        <span>Since</span>
        <DatePicker
          value={pstart}
          onChange={(iso) => selectCustom(iso)}
          size="sm"
          className="w-[8.5rem]"
          ariaLabel="Custom period start date"
        />
      </div>
    </div>
  );
}
