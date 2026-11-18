"use client";

/**
 * Documents & attachments for one LEAD - the same idea as a client's: drop or pick
 * files, see them listed, open / download / delete them. The files are filed against
 * the lead and move to the client automatically when the lead is converted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, FolderOpen, Loader2, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentViewerModal, type ViewerDoc } from "@/components/documents/DocumentViewerModal";

type Doc = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: string | null;
  clientUploaded: boolean;
  createdAt: string;
};

const MAX_BYTES = 15 * 1024 * 1024;

function fmtSize(b?: string | null): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
function fmtDate(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function LeadDocumentsSection({
  leadId,
  canUpload,
  canView = true,
  converted = false,
}: {
  leadId: string;
  /** Kept for callers that still pass it; the server names the vault folder itself. */
  leadName?: string;
  /** May this person see the lead's documents? Follows access to the lead itself. */
  canView?: boolean;
  /** May this person add and remove files (document.upload + edit rights on the lead)? */
  canUpload: boolean;
  /** The lead has become a client - its files now live on the client's record. */
  converted?: boolean;
}) {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerDoc | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/documents`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.documents)) {
        setDocs(j.documents as Doc[]);
        setLoadError(null);
      } else {
        setLoadError(j.error ?? `Could not load documents (${res.status})`);
      }
    } catch {
      setLoadError("Could not load documents - check your connection and refresh.");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (canView) void load();
    else setLoading(false);
  }, [load, canView]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is over 15 MB`, "Too large");
          continue;
        }
        // One call: the server stores the file and files it against this lead.
        const fd = new FormData();
        fd.append("file", file);
        const reg = await fetch(`/api/leads/${leadId}/documents`, { method: "POST", body: fd });
        if (reg.ok) ok += 1;
        else {
          const j = await reg.json().catch(() => ({}));
          toast.error(j.error ?? `Could not save ${file.name}`, "Upload failed");
        }
      }
      if (ok > 0) {
        toast.success(`${ok} document${ok === 1 ? "" : "s"} uploaded`);
        void load();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(d: Doc, mode: "download" | "view") {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/leads/${leadId}/documents/download?docId=${d.id}${mode === "view" ? "&inline=1" : ""}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        toast.error(j.error ?? "Could not open document", mode === "view" ? "View failed" : "Download failed");
        return;
      }
      if (mode === "view") setViewer({ name: d.name, mimeType: d.mimeType, src: j.url, onDownload: () => void open(d, "download") });
      else window.open(j.url, "_blank", "noopener,noreferrer");
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(docId: string) {
    setBusyId(docId);
    try {
      const res = await fetch(`/api/leads/${leadId}/documents?docId=${docId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Document removed");
        setDocs((ds) => ds.filter((x) => x.id !== docId));
      } else {
        toast.error(j.error ?? "Could not delete", "Delete failed");
      }
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  if (!canView) {
    return (
      <div className="border rounded-lg bg-card" id="documents">
        <div className="border-b px-4 py-2.5 font-medium flex items-center gap-2">
          <FolderOpen className="size-4" /> Documents &amp; attachments
        </div>
        <div className="p-4 text-sm text-muted-foreground">
          You do not have access to this lead's documents.
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card" id="documents">
      <div className="border-b px-4 py-2.5 font-medium flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <FolderOpen className="size-4" /> Documents &amp; attachments
          <span className="text-xs text-muted-foreground font-normal">({docs.length})</span>
        </span>
        {canUpload && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {canUpload && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              void uploadFiles(Array.from(e.dataTransfer.files));
            }}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center text-xs transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-border text-muted-foreground hover:bg-secondary/40"
            }`}
          >
            <Upload className="size-5 mx-auto mb-1.5 text-muted-foreground" />
            <div className="font-medium text-foreground">Drag &amp; drop documents here</div>
            <div>or click to browse · PDF, JPG, PNG, DOC, XLS · up to 15 MB each</div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(Array.from(e.target.files))}
        />

        {loadError ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 text-rose-900 text-xs p-2">{loadError}</div>
        ) : loading ? (
          <div className="text-sm text-muted-foreground py-3 flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-3">
            {converted
              ? "This lead is now a client - its documents are on the client's record."
              : "No documents yet. Files you add here move to the client automatically when you convert this lead."}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-brand-cyan-light/20 transition-colors">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    {fmtSize(d.sizeBytes) && <span>{fmtSize(d.sizeBytes)}</span>}
                    {fmtDate(d.createdAt) && <span>{fmtSize(d.sizeBytes) ? "· " : ""}{fmtDate(d.createdAt)}</span>}
                    {d.clientUploaded && <span className="chip text-[9px] bg-emerald-50 text-emerald-700">from the lead</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void open(d, "view")}
                  disabled={busyId === d.id}
                  className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                  title="View"
                >
                  {busyId === d.id ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => void open(d, "download")}
                  disabled={busyId === d.id}
                  className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                  title="Download"
                >
                  <Download className="size-4" />
                </button>
                {canUpload && (
                  <button
                    type="button"
                    onClick={() => setConfirmId(d.id)}
                    disabled={busyId === d.id}
                    className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this document?"
        message="This permanently removes the file from this lead's record."
        confirmLabel="Delete"
        tone="danger"
        busy={busyId === confirmId}
        onConfirm={() => confirmId && void doDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />

      <DocumentViewerModal doc={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
