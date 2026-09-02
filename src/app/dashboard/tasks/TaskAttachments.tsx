"use client";

/**
 * TaskAttachments — upload / list / download / delete files on a task.
 * Downloads use the secure DownloadButton so the API route never shows in
 * the browser chrome.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Upload, Trash, Download } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

type Attachment = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploaderName: string | null;
  createdAt: string;
};

function fmtSize(b: number | null): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskAttachments({ taskId }: { taskId: string }) {
  const toast = useToast();
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/attachments`)
      .then((r) => r.json())
      .then((j) => setItems(Array.isArray(j.attachments) ? j.attachments : []))
      .catch(() => setItems([]));
  }, [taskId]);

  async function upload(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File exceeds 25 MB");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Upload failed");
      setItems((prev) => [{ ...j.attachment, uploaderName: null }, ...(prev ?? [])]);
      toast.success("File attached");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    const prev = items;
    setItems((it) => (it ?? []).filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev ?? []);
      toast.error("Couldn't delete the file");
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
          <Paperclip className="size-3.5" /> Attachments
        </h4>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-secondary text-[11px] px-2 py-1 flex items-center gap-1.5"
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </div>

      {items == null ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No files attached. Max 25 MB per file.</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
              <Paperclip className="size-3.5 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-700 truncate">{a.fileName}</div>
                <div className="text-[10px] text-slate-400">{fmtSize(a.sizeBytes)}{a.uploaderName ? ` · ${a.uploaderName}` : ""}</div>
              </div>
              <DownloadButton
                url={`/api/tasks/${taskId}/attachments/${a.id}/download`}
                filename={a.fileName}
                className="p-1 rounded text-slate-400 hover:text-brand-cyan-deep"
                ariaLabel="Download"
              >
                <Download className="size-3.5" />
              </DownloadButton>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="p-1 rounded text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete attachment"
              >
                <Trash className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
