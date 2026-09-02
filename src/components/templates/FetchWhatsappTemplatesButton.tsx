"use client";

/**
 * "Fetch from WhatsApp" — pulls the firm's existing Meta-approved WhatsApp
 * templates from their connected Vartify workspace into Message Templates.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function FetchWhatsappTemplatesButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function fetchNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/whatsapp/fetch-templates", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        toast.error(j.error ?? "Couldn't fetch WhatsApp templates", "WhatsApp");
        return;
      }
      if (j.fetched === 0) {
        toast.info(
          "Connected — but your WhatsApp (Vartify) workspace has no templates yet. Create & approve them in the Vartify console, then Fetch again.",
          "WhatsApp"
        );
      } else {
        toast.success(`Fetched ${j.fetched} WhatsApp template(s) — ${j.approved} approved & sendable.`, "Synced");
      }
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "WhatsApp");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={fetchNow} disabled={busy} className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50" title="Import your existing WhatsApp templates from Vartify">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {busy ? "Fetching…" : "Fetch from WhatsApp"}
    </button>
  );
}
