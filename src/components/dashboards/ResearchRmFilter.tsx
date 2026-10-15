"use client";

/**
 * "Show me one RM" for the research coverage panel.
 *
 * Research reads this board to compare people — so the first thing wanted after
 * reading it is one person's numbers on their own. Writes the same `?rm=` param
 * the rest of the app uses, so a person picked here is still picked if they
 * move to Clients or Meetings.
 *
 * The options are the RMs already in the table rather than the whole roster:
 * picking someone with no clients would only ever show zeroes.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { User } from "lucide-react";

export function ResearchRmFilter({
  options,
  selected,
}: {
  options: { id: string; name: string }[];
  selected?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(rm: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (rm) params.set("rm", rm);
    else params.delete("rm");
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  if (options.length === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      <User className="size-3.5 text-muted-foreground" />
      <select
        value={selected ?? ""}
        onChange={(e) => go(e.target.value)}
        className="input-base h-8 text-xs py-0 pr-7"
        aria-label="Filter by RM"
      >
        <option value="">All RMs</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {selected ? (
        <button
          type="button"
          onClick={() => go("")}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
