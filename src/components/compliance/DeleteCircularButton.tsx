"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

/** Removes a saved tenant circular. */
export function DeleteCircularButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm("Remove this saved circular?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenant-circulars?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="size-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 grid place-items-center shrink-0"
      aria-label="Delete saved circular"
      title="Remove from library"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}
