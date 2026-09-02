"use client";

/**
 * Client-side controls for the RTA imports page — manual file upload dialog,
 * automated IMAP catch-all mailbox sync button, and FP sync trigger.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, RefreshCw, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { UploadDialog } from "@/components/rta/UploadDialog";

export function RtaUploadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary text-xs sm:text-sm inline-flex items-center gap-1.5">
        <Upload className="size-4" /> Upload RTA file
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * On-demand RTA Mailbox Poller trigger — polls the catch-all mailbox
 * for newly arrived CAMS / KFintech emails and processes attachments immediately.
 */
export function RtaMailboxSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function syncMailbox() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rta/sync-mailbox", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error || "Mailbox sync failed");
      } else {
        setMsg(j.message || "Mailbox checked successfully");
        router.refresh();
      }
    } catch {
      setMsg("Network error while checking mailbox");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={syncMailbox}
        disabled={busy}
        className="btn-secondary text-xs sm:text-sm inline-flex items-center gap-1.5"
        title="Check catch-all mailbox for new CAMS & KFintech mailbacks"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin text-brand-cyan" /> : <Mail className="size-3.5 text-brand-cyan" />}
        <span>{busy ? "Checking Mailbox…" : "Sync Mailbox Now"}</span>
      </button>
      {msg && (
        <span className="text-[11px] text-muted-foreground max-w-xs text-right truncate" title={msg}>
          {msg}
        </span>
      )}
    </div>
  );
}
