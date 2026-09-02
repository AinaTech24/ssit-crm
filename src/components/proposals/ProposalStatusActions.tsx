"use client";

/**
 * Status-transition buttons for the Proposal detail page.
 *
 *   - "Mark as Sent"   → status='sent', stamps sentAt
 *   - "Mark Accepted"  → status='accepted', stamps acceptedAt
 *   - "Mark Rejected"  → status='rejected', stamps rejectedAt + reason
 *
 * Server enforces the same transitions through PATCH /api/proposals/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export function ProposalStatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const LABEL: Record<string, string> = { sent: "marked as sent", accepted: "marked accepted", rejected: "marked rejected" };
  async function transition(next: string, extra: any = {}) {
    setBusy(next);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, ...extra }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't update proposal");
        return;
      }
      toast.success(`Proposal ${LABEL[next] ?? next}.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't update proposal");
    } finally {
      setBusy(null);
    }
  }

  const canSend = status === "draft" || status === "ready";
  const canAccept = status === "sent" || status === "viewed";
  const canReject = status === "sent" || status === "viewed";

  return (
    <div className="flex items-center gap-1.5">
      {canSend && (
        <button
          onClick={() => transition("sent")}
          disabled={!!busy}
          className="btn-accent text-xs"
        >
          {busy === "sent" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Mark as Sent
        </button>
      )}
      {canAccept && (
        <button
          onClick={() => transition("accepted")}
          disabled={!!busy}
          className="btn-primary text-xs"
          style={{ backgroundImage: "linear-gradient(135deg,hsl(165 70% 35%),hsl(165 75% 28%))" }}
        >
          {busy === "accepted" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          Mark Accepted
        </button>
      )}
      {canReject && (
        <button
          onClick={() => {
            const reason = window.prompt("Reason for rejection? (optional)") ?? "";
            void transition("rejected", { rejectionReason: reason });
          }}
          disabled={!!busy}
          className="btn-secondary text-xs"
        >
          {busy === "rejected" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <XCircle className="size-3.5" />
          )}
          Mark Rejected
        </button>
      )}
    </div>
  );
}
