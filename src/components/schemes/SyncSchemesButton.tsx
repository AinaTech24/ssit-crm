"use client";

/**
 * "Sync from AMFI" — seeds the firm's Scheme Master from the platform-shared
 * catalog (AMFI universe + mfapi categories) via POST /api/schemes/sync.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function SyncSchemesButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const res = await fetch("/api/schemes/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error ?? "Sync failed");
        return;
      }
      const total = Number(j.total ?? 0).toLocaleString("en-IN");
      toast.success(
        j.navSeeded
          ? `Fetched the live AMFI universe (${Number(j.navSeeded).toLocaleString("en-IN")}) — ${total} schemes now in your catalog.`
          : `Scheme Master synced — ${total} schemes available.`
      );
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={sync} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {busy ? "Syncing…" : "Sync from AMFI"}
    </button>
  );
}
