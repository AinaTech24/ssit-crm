"use client";

/**
 * Quick-share strip for a goal:
 *   - WhatsApp → wa.me link with the print URL (RM ships from their own WA)
 *   - Email    → sends the DETAILED goal-plan PDF to the client from the firm's
 *                mailbox (POST /api/goals/[id]/email); outcome via toast
 *   - Copy link → the print URL onto the clipboard
 */

import { useState } from "react";
import { MessageCircle, Mail, Copy, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export function GoalShareActions({
  goalId,
  goalName,
  investorName,
  investorPhone,
  investorEmail,
}: {
  goalId: string;
  goalName: string;
  investorName: string;
  investorPhone: string | null;
  investorEmail: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const printUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/dashboard/goals/${goalId}/print?view=detailed`;

  const waMsg = encodeURIComponent(
    `Hi ${investorName}, sharing the latest plan for your "${goalName}" goal. ` +
      `Open this report:\n${printUrl}\n\nLet me know a good time to discuss.`
  );
  const waHref = investorPhone
    ? `https://wa.me/${investorPhone.replace(/[^\d]/g, "")}?text=${waMsg}`
    : `https://wa.me/?text=${waMsg}`;

  function copy() {
    if (!printUrl) return;
    navigator.clipboard.writeText(printUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function sendEmail() {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/email`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Send failed (${res.status})`, "Couldn't email the plan");
        return;
      }
      toast.success(`Goal plan emailed to ${investorName} with the PDF attached.`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't email the plan");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card-surface p-3 flex items-center justify-between flex-wrap gap-2">
      <div className="text-xs text-muted-foreground">
        Send this goal plan to <span className="font-medium text-foreground">{investorName}</span>:
      </div>
      <div className="flex items-center gap-2">
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary text-xs"
          title={investorPhone ? `WhatsApp ${investorPhone}` : "Pick number in WhatsApp Web"}
        >
          <MessageCircle className="size-3.5 text-emerald-600" /> WhatsApp
        </a>
        <button
          onClick={sendEmail}
          disabled={sending || !investorEmail}
          className="btn-secondary text-xs disabled:opacity-50"
          title={investorEmail ? `Email ${investorEmail} the detailed plan PDF` : "No email on file for this client"}
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5 text-blue-600" />} Email
        </button>
        <button onClick={copy} className="btn-secondary text-xs">
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-600" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy link
            </>
          )}
        </button>
      </div>
    </div>
  );
}
