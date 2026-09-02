"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Check } from "lucide-react";

/**
 * "Save SIP" action on the at-risk SIP queue — creates a high-priority RM
 * follow-up task via /api/sips/[id]/defend.
 */
export function DefendSipButton({ sipId, reasons }: { sipId: string; reasons: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function run() {
    setState("busy");
    try {
      const res = await fetch(`/api/sips/${sipId}/defend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasons }),
      });
      if (!res.ok) {
        setState("idle");
        return;
      }
      setState("done");
      router.refresh();
    } catch {
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
        <Check className="size-3.5" /> Task created
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card hover:bg-secondary px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
      title="Create a high-priority recovery task for the RM"
    >
      {state === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
      Save SIP
    </button>
  );
}
