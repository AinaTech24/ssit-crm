"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function MfSchemeSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    router.push(v ? `/dashboard/mf-schemes?q=${encodeURIComponent(v)}` : "/dashboard/mf-schemes");
  }

  return (
    <form onSubmit={submit} className="relative max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by scheme name or AMC — e.g. “HDFC Flexi Cap”, “Axis”…"
        className="w-full h-10 rounded-lg border border-border bg-card pl-10 pr-3 text-sm focus:outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15"
      />
    </form>
  );
}
