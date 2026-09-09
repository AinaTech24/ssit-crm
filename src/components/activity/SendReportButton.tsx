"use client";

/**
 * "Send report" — pick an RM, attach files, send.
 *
 * The RM list is the same roster the assignee pickers use, filtered to `rm`.
 * The recipient address is resolved server-side from the chosen user, so this
 * is not a way to mail an arbitrary address from the firm's mailbox.
 */

import { useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { AttachmentPicker } from "@/components/common/EntityAttachments";
import { useToast } from "@/components/ui/Toast";
import { readApiError, readThrownError } from "@/lib/api/client-error";

export function SendReportButton({ defaultSubject = "" }: { defaultSubject?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rmUserId, setRmUserId] = useState<string | null>(null);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRmUserId(null);
    setSubject(defaultSubject);
    setMessage("");
    setFiles([]);
  }

  async function send() {
    if (!rmUserId) return toast.error("Choose an RM to send to.");
    if (!subject.trim()) return toast.error("Give the report a subject.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("rmUserId", rmUserId);
      fd.append("subject", subject.trim());
      fd.append("message", message.trim());
      for (const f of files) fd.append("files", f);

      const res = await fetch("/api/activity-entries/send-report", { method: "POST", body: fd });
      if (!res.ok) {
        toast.error((await readApiError(res, "send the report")).message);
        return;
      }
      const j = await res.json();
      toast.success(
        `Report sent to ${j.to}${j.files ? ` with ${j.files} file${j.files === 1 ? "" : "s"}` : ""}.`
      );
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(readThrownError(e, "send the report").message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
        <Send className="size-4" /> Send report
      </button>
    );
  }

  return (
    <div className="card-surface p-4 space-y-3 w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <Send className="size-4" /> Send report to an RM
        </h3>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium mb-1">Send to (RM) *</div>
          <RmSelector role="rm" value={rmUserId} onChange={setRmUserId} placeholder="— Choose an RM —" />
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Subject *</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Weekly research summary"
            className="input-base w-full"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-xs font-medium mb-1">Message</div>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="input-base w-full text-xs" />
      </label>

      <AttachmentPicker
        files={files}
        onChange={setFiles}
        disabled={busy}
        label="Attachments"
        hint="Attach the report, model or note. They are emailed with the message — nothing is stored on the CRM. Max 25 MB each."
      />

      <div className="flex justify-end gap-2 pt-1 border-t border-border">
        <button onClick={() => { setOpen(false); reset(); }} className="btn-secondary text-xs">Cancel</button>
        <button onClick={send} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send
        </button>
      </div>
    </div>
  );
}
