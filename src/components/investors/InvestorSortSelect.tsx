"use client";

/**
 * Investor list sort — an ICON-ONLY dropdown, styled to match the other toolbar
 * icon buttons (Filters / Columns / Views) so the table header stays a clean row
 * of glyphs instead of a wide "Date added — newest" select.
 *
 * Writes `?sort` + `?dir` (the same params the column-header arrows use, so the
 * two stay in sync). Direction is encoded in each option ("col:dir") so the menu
 * offers ascending AND descending.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDownUp, Check } from "lucide-react";

const OPTIONS = [
  { value: "aum:desc", label: "AUM — high to low" },
  { value: "aum:asc", label: "AUM — low to high" },
  { value: "created:desc", label: "Date added — newest" },
  { value: "created:asc", label: "Date added — oldest" },
  { value: "name:asc", label: "Name — A to Z" },
  { value: "name:desc", label: "Name — Z to A" },
  { value: "sip:desc", label: "Monthly SIP — high to low" },
  { value: "sip:asc", label: "Monthly SIP — low to high" },
  { value: "health:asc", label: "Health — worst first" },
  { value: "health:desc", label: "Health — best first" },
];

export function InvestorSortSelect({ sort, dir }: { sort: string; dir: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = OPTIONS.some((o) => o.value === `${sort}:${dir}`) ? `${sort}:${dir}` : "aum:desc";
  // Non-default sort → tint the button, same cue the Filters button uses.
  const active = current !== "aum:desc";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(v: string) {
    const [col, d] = v.split(":");
    const p = new URLSearchParams(sp.toString());
    // AUM is the implicit default — keep the URL clean by dropping the param.
    if (col === "aum") p.delete("sort");
    else p.set("sort", col);
    p.set("dir", d);
    p.delete("page");
    setOpen(false);
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Sort"
        aria-label="Sort investors"
        className={`inline-flex items-center justify-center rounded-lg border size-8 transition ${
          active
            ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep"
            : "bg-card border-border hover:bg-brand-cyan-light/40"
        }`}
      >
        <ArrowDownUp className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 card-elevated bg-card p-1 animate-scale-in">
          <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wide text-muted-foreground">Sort by</div>
          {OPTIONS.map((o) => {
            const isCur = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className={`w-full text-left flex items-center gap-2 rounded px-2 py-1.5 text-xs transition ${
                  isCur ? "bg-brand-cyan-light/50 text-brand-cyan-deep font-semibold" : "hover:bg-secondary/60"
                }`}
              >
                {isCur ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
