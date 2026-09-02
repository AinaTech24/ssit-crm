"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";

export function CloneRuleButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clone() {
    if (!confirm(`Clone the rule "${name}"? The cloned rule will be disabled until you review it.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/workflow-rules/${id}/clone`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "Failed to clone rule");
      router.push(`/dashboard/workflows/rules/${data.rule.id}`);
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? "Failed to clone rule");
      setBusy(false);
    }
  }

  return (
    <button onClick={clone} disabled={busy} className="btn-secondary text-xs">
      <Copy className="size-3.5" /> {busy ? "Cloning..." : "Clone"}
    </button>
  );
}
