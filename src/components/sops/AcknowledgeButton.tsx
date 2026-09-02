"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ScrollText } from "lucide-react";
import { formatDate } from "@/lib/utils";

export function AcknowledgeButton({
  sopId,
  hasAcknowledged,
  acknowledgedAt,
}: {
  sopId: string;
  hasAcknowledged: boolean;
  acknowledgedAt?: string | Date | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleAcknowledge() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sops/${encodeURIComponent(sopId)}/acknowledge`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to record acknowledgement.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving acknowledgement.");
    } finally {
      setBusy(false);
    }
  }

  if (hasAcknowledged) {
    return (
      <div className="flex items-center gap-2">
        <button
          disabled
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50 cursor-not-allowed"
        >
          <Check className="size-4" /> Acknowledged
        </button>
        {acknowledgedAt && (
          <span className="text-xs text-muted-foreground">
            Signed on {formatDate(acknowledgedAt)}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleAcknowledge}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ScrollText className="size-4" />
      )}
      {busy ? "Signing..." : "Acknowledge & Sign"}
    </button>
  );
}
