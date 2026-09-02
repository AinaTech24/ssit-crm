"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Manual refresh for the Control Tower — re-runs the server component. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="text-xs inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-medium hover:bg-accent disabled:opacity-60"
      title="Refresh the monitor"
    >
      <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
      Refresh
    </button>
  );
}
