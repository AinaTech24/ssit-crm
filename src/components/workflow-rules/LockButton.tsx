"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Unlock } from "lucide-react";

export function LockButton({
  id,
  locked,
  lockReason,
}: {
  id: string;
  locked: boolean;
  lockReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      let reason = lockReason;
      if (!locked) {
        const r = prompt("Reason for locking (shown to other admins):", "");
        if (r === null) {
          setBusy(false);
          return;
        }
        reason = r.trim();
      }
      const res = await fetch(`/api/workflow-rules/${id}/lock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: locked ? "unlock" : "lock", reason }),
      });
      if (!res.ok) alert("Failed to update lock");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={toggle} disabled={busy} className="btn-secondary text-xs">
      {locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
      {locked ? "Unlock" : "Lock"}
    </button>
  );
}
