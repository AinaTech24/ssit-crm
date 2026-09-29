"use client";

/**
 * "Where does this pipeline actually sit?" — counts per sub-branch and per
 * person, each one a shortcut into that slice.
 *
 * Every card is a filter, not just a number: clicking one sets the same
 * `?unit=` / `?rm=` params the dropdowns use, so reading a count and drilling
 * into it are the same gesture. The card for the slice you are already looking
 * at is highlighted and clicking it again clears the filter, so there is
 * always a way back out.
 *
 * Counts come from the SAME query the list uses, wall and filters included, so
 * the cards can never disagree with the rows underneath them.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, User } from "lucide-react";

type UnitRow = { label: string; count: number; unitValue: string | null };
type MemberRow = { label: string; count: number; memberId: string | null };

export function ScopeBreakdownCards({
  basePath,
  byUnit,
  byMember,
  noun = "records",
}: {
  basePath: string;
  byUnit: UnitRow[];
  byMember: MemberRow[];
  noun?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const currentUnit = sp?.get("unit") ?? "";
  const currentRm = sp?.get("rm") ?? "";

  function apply(next: { unit?: string | null; rm?: string | null }) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (next.unit !== undefined) {
      if (next.unit) params.set("unit", next.unit);
      else params.delete("unit");
      // Picking a different desk makes a person chosen inside the old one
      // meaningless, so it clears with it.
      params.delete("rm");
    }
    if (next.rm !== undefined) {
      if (next.rm) params.set("rm", next.rm);
      else params.delete("rm");
    }
    params.delete("page");
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  }

  if (byUnit.length === 0 && byMember.length === 0) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Group
        icon={<Building2 className="size-3.5" />}
        title={`By sub-branch`}
        rows={byUnit.map((u) => ({
          key: u.unitValue ?? "none",
          label: u.label,
          count: u.count,
          active: !!u.unitValue && currentUnit === u.unitValue,
          // Rows with no desk cannot be filtered to — there is no desk to
          // select — so they read as a count only.
          onClick: u.unitValue
            ? () => apply({ unit: currentUnit === u.unitValue ? "" : u.unitValue })
            : undefined,
        }))}
        noun={noun}
      />
      <Group
        icon={<User className="size-3.5" />}
        title="By RM"
        rows={byMember.map((m) => ({
          key: m.memberId ?? "none",
          label: m.label,
          count: m.count,
          active: !!m.memberId && currentRm === m.memberId,
          onClick: m.memberId
            ? () => apply({ rm: currentRm === m.memberId ? "" : m.memberId })
            : undefined,
        }))}
        noun={noun}
      />
    </div>
  );
}

function Group({
  icon,
  title,
  rows,
  noun,
}: {
  icon: React.ReactNode;
  title: string;
  rows: { key: string; label: string; count: number; active: boolean; onClick?: () => void }[];
  noun: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
        {icon} {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => {
          const body = (
            <>
              <span className="truncate max-w-[10rem]">{r.label}</span>
              <span className="tabular-nums font-semibold">{r.count}</span>
            </>
          );
          const cls = `inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
            r.active
              ? "border-brand-cyan bg-brand-cyan/10 text-brand-cyan font-medium"
              : "border-border bg-secondary/30"
          }`;
          return r.onClick ? (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              title={r.active ? "Clear this filter" : `Show only ${r.label}'s ${noun}`}
              className={`${cls} hover:bg-accent transition-colors`}
            >
              {body}
            </button>
          ) : (
            <span key={r.key} className={`${cls} opacity-70`} title={`Not on a sub-branch`}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}
