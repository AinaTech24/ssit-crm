"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Check } from "lucide-react";

/**
 * Generic re-queue button for the Automation Monitor. POSTs to `endpoint`
 * (a failed run, scheduled job, or stuck outbox event) and refreshes on success.
 */
export function RetryButton({ endpoint, title, label = "Retry", doneLabel = "Re-queued" }: { endpoint: string; title?: string; label?: string; doneLabel?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={retry}
        disabled={busy || done}
        className="text-xs inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent disabled:opacity-60"
        title={title ?? "Re-queue — the worker will run it again"}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : done ? <Check className="size-3 text-emerald-600" /> : <RotateCcw className="size-3" />}
        {done ? doneLabel : label}
      </button>
      {err && <span className="text-[10px] text-rose-600" title={err}>{err}</span>}
    </span>
  );
}
