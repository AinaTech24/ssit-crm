"use client";

/**
 * Row actions for a soft-deleted client in the Trash bin:
 *   - Recover  → POST /api/investors/[id]/restore (clears deleted_at)
 *   - Delete permanently → DELETE /api/investors/[id]?purge=1 (irreversible
 *     hard delete + cascade), behind a danger confirm.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function TrashActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<null | "restore" | "purge">(null);
  const [confirmPurge, setConfirmPurge] = useState(false);

  async function recover() {
    setBusy("restore");
    try {
      const res = await fetch(`/api/investors/${id}/restore`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't recover");
        return;
      }
      toast.success(`${name} restored`);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't recover");
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    setBusy("purge");
    try {
      const res = await fetch(`/api/investors/${id}?purge=1`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Couldn't delete");
        return;
      }
      toast.success(`${name} permanently deleted`);
      setConfirmPurge(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Network error", "Couldn't delete");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={recover} disabled={busy !== null} className="btn-secondary text-xs">
        {busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Recover
      </button>
      <button
        onClick={() => setConfirmPurge(true)}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
      >
        <Trash2 className="size-3.5" /> Delete permanently
      </button>
      <ConfirmDialog
        open={confirmPurge}
        title="Delete permanently?"
        message={`This irreversibly erases ${name} and all of their folios, transactions, SIPs, goals and documents. This cannot be undone.`}
        confirmLabel="Delete forever"
        tone="danger"
        busy={busy === "purge"}
        onConfirm={purge}
        onCancel={() => setConfirmPurge(false)}
      />
    </div>
  );
}
