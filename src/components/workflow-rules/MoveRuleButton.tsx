"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

export function MoveRuleButton({
  id,
  direction,
  disabled,
}: {
  id: string;
  direction: "up" | "down";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const Icon = direction === "up" ? ArrowUp : ArrowDown;

  async function move() {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workflow-rules/${id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "Failed to reorder rule");
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? "Failed to reorder rule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={move}
      disabled={disabled || busy}
      className="inline-grid size-7 place-items-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
      title={direction === "up" ? "Move rule up" : "Move rule down"}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
