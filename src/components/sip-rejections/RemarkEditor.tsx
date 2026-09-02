"use client";

/**
 * Tiny inline remarks editor for a SIP-rejection row.
 *
 * Click pencil → input opens → press Enter / blur → PATCH the new value.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";

export function RemarkEditor({
  rejectionId,
  initial,
}: {
  rejectionId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sip-rejections/${rejectionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remarks: val }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Save failed");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 max-w-[180px] truncate text-left"
        title="Click to edit"
      >
        {val ? (
          <span className="truncate">{val}</span>
        ) : (
          <span className="italic">Add remark</span>
        )}
        <Pencil className="size-3 flex-shrink-0 opacity-60" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setVal(initial ?? "");
            setEditing(false);
          }
        }}
        disabled={busy}
        className="text-xs border border-border rounded px-1.5 py-0.5 bg-background w-[180px]"
      />
      <button onClick={save} disabled={busy} className="text-emerald-600 hover:bg-emerald-50 rounded p-0.5">
        <Check className="size-3.5" />
      </button>
      <button
        onClick={() => {
          setVal(initial ?? "");
          setEditing(false);
        }}
        className="text-muted-foreground hover:bg-secondary rounded p-0.5"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
