"use client";

/**
 * Restore / permanently-delete actions for a soft-deleted task in the Trash bin.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function TaskTrashActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"restore" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function restore() {
    setBusy("restore");
    try {
      const res = await fetch(`/api/tasks/${id}/restore`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not restore the task");
      }
      toast.success("Task restored");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed", "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/tasks/${id}?permanent=1`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not delete the task");
      }
      toast.success("Task permanently deleted");
      setConfirm(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed", "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={restore}
        disabled={!!busy}
        className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
      >
        {busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Restore
      </button>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={!!busy}
        className="text-xs py-1 px-2 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1 font-medium disabled:opacity-50"
      >
        <Trash2 className="size-3.5" /> Delete
      </button>
      <ConfirmDialog
        open={confirm}
        title="Delete permanently?"
        message={`Permanently delete “${title}”? This cannot be undone.`}
        confirmLabel="Delete permanently"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={purge}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
