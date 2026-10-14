"use client";

/**
 * Sub-branch dropdown for the research dashboard's meetings.
 *
 * Writes the same `?unit=d:<deskId>` param the rest of the app uses, so the
 * view keeps whatever else is in the URL (like `as=ra` for an admin).
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";

export function ResearchUnitFilter({
  options,
  selected,
}: {
  options: { id: string; name: string }[];
  selected?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(deskId: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (deskId) params.set("unit", `d:${deskId}`);
    else params.delete("unit");
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  if (options.length === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      <Building2 className="size-3.5 text-muted-foreground" />
      <select
        value={selected ?? ""}
        onChange={(e) => go(e.target.value)}
        className="input-base h-8 text-xs py-0 pr-7"
        aria-label="Filter by sub-branch"
      >
        <option value="">All sub-branches</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {selected ? (
        <button type="button" onClick={() => go("")} className="text-[11px] text-muted-foreground hover:underline">
          Clear
        </button>
      ) : null}
    </div>
  );
}
