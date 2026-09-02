"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, X, MessageCircle, Loader2 } from "lucide-react";

type Props = {
  itemKey: string;
  actionType?: "task" | "birthday" | "anniversary" | "generic";
  taskId?: string;
  phone?: string | null;
  name?: string;
  /** WhatsApp wish message (birthday / anniversary). */
  wishText?: string;
};

/**
 * Inline quick-actions for a Command Center row: act without leaving the queue.
 * Snooze / dismiss is universal; mark-done (tasks) and send-wish (birthday /
 * anniversary) are type-specific. All actions refresh the queue on success.
 */
export function CommandItemActions({ itemKey, actionType, taskId, phone, wishText }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function snooze(action: "1d" | "dismiss") {
    setBusy(action);
    try {
      await fetch("/api/command-center/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemKey, action }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function markDone() {
    if (!taskId) return;
    setBusy("done");
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function wish() {
    if (!phone) return;
    const num = phone.replace(/[^\d]/g, "");
    const url = `https://wa.me/${num}?text=${encodeURIComponent(wishText ?? "")}`;
    window.open(url, "_blank", "noopener,noreferrer");
    // Auto-snooze for the day so it drops off the list once wished.
    void snooze("dismiss");
  }

  const Btn = ({
    onClick,
    title,
    children,
    tone = "default",
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    tone?: "default" | "emerald" | "violet";
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={!!busy}
      className={`rounded-md p-1.5 hover:bg-accent transition-colors disabled:opacity-50 ${
        tone === "emerald" ? "text-emerald-600" : tone === "violet" ? "text-violet-600" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {(actionType === "birthday" || actionType === "anniversary") && phone && (
        <Btn onClick={wish} title="Send wish on WhatsApp" tone="violet">
          <MessageCircle className="size-3.5" />
        </Btn>
      )}
      {actionType === "task" && taskId && (
        <Btn onClick={markDone} title="Mark done" tone="emerald">
          <Check className="size-3.5" />
        </Btn>
      )}
      <Btn onClick={() => snooze("1d")} title="Snooze 1 day">
        <Clock className="size-3.5" />
      </Btn>
      <Btn onClick={() => snooze("dismiss")} title="Dismiss">
        <X className="size-3.5" />
      </Btn>
    </div>
  );
}
