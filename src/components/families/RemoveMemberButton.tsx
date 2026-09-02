"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export function RemoveMemberButton({
  familyId,
  investorId,
  investorName,
}: {
  familyId: string;
  investorId: string;
  investorName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/families/${familyId}/members?investorId=${investorId}`, {
        method: "DELETE",
      });
      // The old window.confirm() flow ignored the response entirely, so a failed
      // unlink (403 from the assignment guard, say) looked identical to success
      // until the refresh silently showed the member still there.
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Could not remove the member", "Remove failed");
        return;
      }
      setConfirming(false);
      toast.success(`${investorName} removed from this family`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="text-xs text-rose-600 hover:underline disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin inline" /> : "Remove"}
      </button>

      <ConfirmDialog
        open={confirming}
        title={`Remove ${investorName} from this family?`}
        message="The investor record is kept — only the household link is removed. You can re-link them at any time."
        confirmLabel="Remove member"
        tone="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
