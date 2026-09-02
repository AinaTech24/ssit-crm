"use client";

/**
 * Reusable offset pager for server-rendered list pages.
 *
 * Reads/writes the `page` URL param while preserving every other filter/sort
 * param already on the URL (so paging a filtered, sorted list keeps the
 * filter + sort). Pure navigation — the server component re-queries with the
 * new offset. Hidden entirely when there's only one page.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pager({
  page,
  totalPages,
  total,
  pageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (totalPages <= 1) return null;

  const go = (n: number) => {
    const sp = new URLSearchParams(params.toString());
    if (n <= 1) sp.delete("page");
    else sp.set("page", String(n));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Compact window of page numbers around the current page.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-3 text-sm">
      <span className="text-muted-foreground text-xs">
        Showing <span className="font-medium text-foreground">{from.toLocaleString("en-IN")}</span>–
        <span className="font-medium text-foreground">{to.toLocaleString("en-IN")}</span> of{" "}
        <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent"
        >
          <ChevronLeft className="size-3.5" /> Prev
        </button>
        {start > 1 && (
          <>
            <PageBtn n={1} active={page === 1} onClick={go} />
            {start > 2 && <span className="px-1 text-muted-foreground">…</span>}
          </>
        )}
        {nums.map((n) => (
          <PageBtn key={n} n={n} active={n === page} onClick={go} />
        ))}
        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="px-1 text-muted-foreground">…</span>}
            <PageBtn n={totalPages} active={page === totalPages} onClick={go} />
          </>
        )}
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent"
        >
          Next <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function PageBtn({ n, active, onClick }: { n: number; active: boolean; onClick: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      aria-current={active ? "page" : undefined}
      className={`min-w-[1.75rem] rounded-md border px-2 py-1 text-xs ${
        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
      }`}
    >
      {n}
    </button>
  );
}
