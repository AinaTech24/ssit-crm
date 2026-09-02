"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

/** Inline control: how many days a soft-deleted tenant is kept before purge. */
export function RetentionSettingForm({ current }: { current: number }) {
  const router = useRouter();
  const [days, setDays] = useState(String(current));
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      alert("Enter 1–3650 days");
      return;
    }
    setState("saving");
    try {
      const res = await fetch("/api/super-admin/settings/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: Math.round(n) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Failed to save");
        setState("idle");
        return;
      }
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("idle");
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Auto-purge soft-deleted tenants after</span>
      <input
        type="number"
        min={1}
        max={3650}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className="w-16 border border-border rounded-md px-2 py-1 text-xs text-foreground bg-card"
      />
      <span>days</span>
      <button onClick={save} disabled={state === "saving"} className="rounded-md border px-2.5 py-1 font-medium text-foreground hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1">
        {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : state === "saved" ? <Check className="size-3 text-emerald-600" /> : null}
        {state === "saved" ? "Saved" : "Save"}
      </button>
    </div>
  );
}
