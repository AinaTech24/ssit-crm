"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

/** "Run reconciliation now" button — triggers the engine for this tenant. */
export function RunReconButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reconciliation/run", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error ?? `Failed (${res.status})`);
        return;
      }
      setMsg(`${j.exceptionsOpen ?? 0} open · ${j.autoResolved ?? 0} auto-resolved`);
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={run} disabled={busy} className="btn-primary text-xs whitespace-nowrap">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Run reconciliation
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}

/** Per-row status control for a reconciliation break. */
export function ReconRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(status);

  async function update(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/reconciliation/exceptions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setCur(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SelectField
      value={cur}
      disabled={busy}
      onChange={(e) => update(e.target.value)}
      size="sm"
      className="w-36"
      aria-label="Update break status"
    >
      <option value="open">Open</option>
      <option value="investigating">Investigating</option>
      <option value="resolved">Resolved</option>
      <option value="ignored">Ignored</option>
    </SelectField>
  );
}
