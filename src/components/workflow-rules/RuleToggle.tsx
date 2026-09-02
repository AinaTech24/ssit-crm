"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RuleToggle({
  id,
  enabled,
  locked,
}: {
  id: string;
  enabled: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(enabled);

  async function toggle() {
    if (locked || busy) return;
    setBusy(true);
    setOn((v) => !v); // optimistic
    try {
      const r = await fetch(`/api/workflow-rules/${id}/toggle`, { method: "POST" });
      if (!r.ok) {
        setOn(enabled); // revert
        alert("Failed to toggle rule");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={locked || busy}
      onClick={toggle}
      title={locked ? "Rule is locked — cannot toggle" : on ? "Disable rule" : "Enable rule"}
      className={`inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-brand-cyan" : "bg-secondary border border-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
