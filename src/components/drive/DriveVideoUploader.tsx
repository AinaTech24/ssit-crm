"use client";

/**
 * "Upload video to Google Drive" - for the Social Media Tracker (and anywhere else that holds a
 * video). The file goes from the browser straight into our storage (with a progress bar), then
 * the CRM copies it to the firm's Google Drive in the background and reports back the Drive link.
 *
 *   1. POST /api/drive/upload-url   - checks Drive is connected + the size, returns a storage URL
 *   2. PUT  <that url>              - the file itself (progress shown; retried if the network blips)
 *   3. POST /api/drive/uploads      - queues the copy to Drive
 *   4. GET  /api/drive/uploads/:id  - polled until the copy is done (or failed, with a Retry)
 *
 * `onDone(link)` receives the Drive link; the caller stores it. Staff can also just type a link.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudUpload, Loader2, RotateCcw } from "lucide-react";
import { MAX_DRIVE_UPLOAD_BYTES, formatMb } from "@/lib/integrations/drive-limits";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; pct: number; name: string }
  | { kind: "copying"; name: string; id: string }
  | { kind: "done"; name: string; folder: string | null }
  | { kind: "error"; message: string; retryId?: string; name?: string };

/** PUT the file with progress, retrying twice if the network drops. */
function putWithProgress(url: string, file: File, onPct: (n: number) => void): Promise<void> {
  const once = () =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status}).`)));
      xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
      xhr.send(file);
    });
  return (async () => {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        onPct(0);
        return await once();
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw last instanceof Error ? last : new Error("Upload failed.");
  })();
}

export function DriveVideoUploader({
  source = "social_tracker",
  folderDate,
  onDone,
  disabled,
}: {
  source?: "social_tracker" | "content_library";
  /** yyyy-mm-dd - the month folder in Drive follows this (the post's date). */
  folderDate?: string;
  onDone: (driveUrl: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Poll the copy until it ends. */
  async function watch(id: string, name: string) {
    setPhase({ kind: "copying", name, id });
    const until = Date.now() + 40 * 60_000;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!alive.current) return;
      try {
        const j = await fetch(`/api/drive/uploads/${id}`, { cache: "no-store" }).then((r) => r.json());
        if (j.status === "done" && j.driveUrl) {
          setPhase({ kind: "done", name, folder: j.driveFolder ?? null });
          onDone(String(j.driveUrl));
          return;
        }
        if (j.status === "failed") {
          setPhase({ kind: "error", message: j.error ?? "The copy to Google Drive failed.", retryId: id, name });
          return;
        }
      } catch {
        /* a missed poll is fine - try again */
      }
    }
    if (alive.current) setPhase({ kind: "error", message: "Still copying - check back in a few minutes, or paste the Drive link yourself.", name });
  }

  async function pick(file: File) {
    if (file.size > MAX_DRIVE_UPLOAD_BYTES) {
      setPhase({ kind: "error", message: `This video is ${formatMb(file.size)}. The limit is ${formatMb(MAX_DRIVE_UPLOAD_BYTES)} - upload it to Google Drive yourself and paste the link.` });
      return;
    }
    setPhase({ kind: "sending", pct: 0, name: file.name });
    try {
      const pre = await fetch("/api/drive/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "video/mp4", size: file.size }),
      });
      const pj = await pre.json().catch(() => ({}));
      if (!pre.ok) {
        setPhase({ kind: "error", message: pj.error ?? `Could not start the upload (${pre.status}).` });
        return;
      }
      await putWithProgress(pj.url, file, (pct) => alive.current && setPhase({ kind: "sending", pct, name: file.name }));
      const q = await fetch("/api/drive/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: pj.key, fileName: file.name, contentType: file.type || "video/mp4", source, folderDate }),
      });
      const qj = await q.json().catch(() => ({}));
      if (!q.ok) {
        setPhase({ kind: "error", message: qj.error ?? `Could not queue the copy (${q.status}).` });
        return;
      }
      await watch(qj.id, file.name);
    } catch (e) {
      if (alive.current) setPhase({ kind: "error", message: e instanceof Error ? e.message : "Upload failed." });
    }
  }

  async function retry(id: string, name: string) {
    const r = await fetch(`/api/drive/uploads/${id}/retry`, { method: "POST" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setPhase({ kind: "error", message: j.error ?? "Could not retry.", name });
      return;
    }
    await watch(id, name);
  }

  const busy = phase.kind === "sending" || phase.kind === "copying";

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
        Upload video to Google Drive
      </button>

      {phase.kind === "sending" && (
        <div className="space-y-1">
          <div className="h-1.5 w-full max-w-xs rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${phase.pct}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Uploading {phase.name} - {phase.pct}%
          </div>
        </div>
      )}
      {phase.kind === "copying" && (
        <div className="text-[11px] text-muted-foreground">Uploaded. Copying {phase.name} to Google Drive - you can keep working.</div>
      )}
      {phase.kind === "done" && (
        <div className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
          <CheckCircle2 className="size-3.5" /> {phase.name} is in Google Drive{phase.folder ? ` (${phase.folder})` : ""}. The link is filled in.
        </div>
      )}
      {phase.kind === "error" && (
        <div className="text-[11px] text-destructive flex items-center gap-2 flex-wrap">
          <span>{phase.message}</span>
          {phase.retryId && (
            <button type="button" onClick={() => void retry(phase.retryId!, phase.name ?? "video")} className="inline-flex items-center gap-1 underline">
              <RotateCcw className="size-3" /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
