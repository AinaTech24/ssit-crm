"use client";

/**
 * Meeting document attachments.
 *
 * Two modes, one look:
 *
 *   <MeetingAttachmentPicker>  — used on the "Add meeting" form, where the
 *       meeting does not exist yet. Files are held in memory; the form uploads
 *       them with `uploadMeetingAttachments()` right after the meeting is
 *       created.
 *
 *   <MeetingAttachments meetingId>  — used on the meeting detail page. Files
 *       upload immediately and the list is loaded from the API.
 *
 * Bytes land in S3 (lib/storage/s3.ts), never in the browser's local storage.
 * Downloads go through the authenticated proxy route so the bucket stays
 * private.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Upload, Trash, Download, FileText } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // keep in sync with the API
const MAX_FILES_PER_REQUEST = 20;

type Attachment = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploaderName?: string | null;
  createdAt: string;
};

export function fmtSize(b: number | null | undefined): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * POSTs files to a meeting's attachment endpoint. Sent as ONE multipart request
 * with a repeated `files` field. Returns the created rows; throws with the
 * API's message so the caller can surface it.
 */
export async function uploadMeetingAttachments(meetingId: string, files: File[]): Promise<Attachment[]> {
  if (files.length === 0) return [];
  const out: Attachment[] = [];
  // Chunked so a long pick never trips the per-request file cap.
  for (let i = 0; i < files.length; i += MAX_FILES_PER_REQUEST) {
    const fd = new FormData();
    for (const f of files.slice(i, i + MAX_FILES_PER_REQUEST)) fd.append("files", f);
    const res = await fetch(`/api/review-meetings/${meetingId}/attachments`, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error ?? "Upload failed");
    out.push(...(j.attachments ?? []));
  }
  return out;
}

/** Shared chrome: header with an Upload button + a drag-and-drop surface. */
function DropZone({
  label,
  busy,
  onFiles,
  children,
}: {
  label: string;
  busy: boolean;
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = useCallback(
    (list: FileList | null) => {
      const files = Array.from(list ?? []);
      if (files.length) onFiles(files);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFiles]
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          <Paperclip className="size-3.5" /> {label}
        </h4>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn-secondary text-[11px] px-2 py-1 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
          {busy ? "Uploading…" : "Add files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handle(e.target.files)}
        />
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        className={`rounded-lg border border-dashed px-3 py-2.5 transition-colors ${
          over ? "border-brand-cyan bg-brand-cyan-light/60" : "border-border bg-secondary/30"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Row({
  name,
  size,
  meta,
  onRemove,
  download,
}: {
  name: string;
  size: number | null | undefined;
  meta?: string | null;
  onRemove: () => void;
  download?: { url: string; filename: string };
}) {
  return (
    <li className="group flex items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5">
      <FileText className="size-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{name}</div>
        <div className="text-[10px] text-muted-foreground">
          {fmtSize(size)}
          {meta ? ` · ${meta}` : ""}
        </div>
      </div>
      {download && (
        <DownloadButton
          url={download.url}
          filename={download.filename}
          className="p-1 rounded text-muted-foreground hover:text-brand-cyan-deep"
          ariaLabel="Download"
        >
          <Download className="size-3.5" />
        </DownloadButton>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded text-muted-foreground/60 hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`Remove ${name}`}
      >
        <Trash className="size-3.5" />
      </button>
    </li>
  );
}

/* ───────────────────────── Add-meeting form (staged) ───────────────────────── */

/**
 * File picker for a meeting that does not exist yet. The parent owns the list
 * and uploads it after the meeting is created.
 */
export function MeetingAttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const toast = useToast();

  function add(picked: File[]) {
    const ok: File[] = [];
    for (const f of picked) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`"${f.name}" exceeds 25 MB`);
        continue;
      }
      // Same name + size + mtime twice in one pick is a duplicate, not two docs.
      const dupe = files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
      if (!dupe) ok.push(f);
    }
    if (ok.length) onChange([...files, ...ok]);
  }

  return (
    <DropZone label={`Attachments${files.length ? ` (${files.length})` : ""}`} busy={!!disabled} onFiles={add}>
      {files.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Drop agenda packs, statements or forms here — or use “Add files”. They upload when the meeting is
          scheduled. Max 25 MB each.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <Row
              key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
              name={f.name}
              size={f.size}
              meta="ready to upload"
              onRemove={() => onChange(files.filter((_, x) => x !== i))}
            />
          ))}
        </ul>
      )}
    </DropZone>
  );
}

/* ─────────────────────── Existing meeting (live upload) ─────────────────────── */

/** Upload / list / download / delete documents on a saved meeting. */
export function MeetingAttachments({
  meetingId,
  label = "Attachments",
  readOnly,
}: {
  meetingId: string;
  label?: string;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/review-meetings/${meetingId}/attachments`)
      .then((r) => r.json())
      .then((j) => { if (alive) setItems(Array.isArray(j.attachments) ? j.attachments : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [meetingId]);

  async function upload(picked: File[]) {
    const ok = picked.filter((f) => {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`"${f.name}" exceeds 25 MB`);
        return false;
      }
      return true;
    });
    if (ok.length === 0) return;
    setBusy(true);
    try {
      const created = await uploadMeetingAttachments(meetingId, ok);
      setItems((prev) => [...created, ...(prev ?? [])]);
      toast.success(created.length === 1 ? "File attached" : `${created.length} files attached`);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const prev = items;
    setItems((it) => (it ?? []).filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/review-meetings/${meetingId}/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev ?? []);
      toast.error("Couldn't delete the file");
    }
  }

  const count = items?.length ?? 0;

  return (
    <DropZone
      label={`${label}${count ? ` (${count})` : ""}`}
      busy={busy}
      onFiles={readOnly ? () => {} : upload}
    >
      {items == null ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No documents yet. Drop files here or use “Add files”. Max 25 MB each.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <Row
              key={a.id}
              name={a.fileName}
              size={a.sizeBytes}
              meta={a.uploaderName ?? null}
              onRemove={() => remove(a.id)}
              download={{
                url: `/api/review-meetings/${meetingId}/attachments/${a.id}/download`,
                filename: a.fileName,
              }}
            />
          ))}
        </ul>
      )}
    </DropZone>
  );
}
