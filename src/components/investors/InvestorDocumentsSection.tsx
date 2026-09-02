"use client";

/**
 * InvestorDocumentsSection — Documents & attachments for one client. Self-
 * fetching island used on the investor-360 page. Lists files linked to this
 * investor in `compliance_documents` (RM-uploaded here + auto-ingested uploads
 * from the public required-documents form), with upload / download / delete.
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Loader2, FolderOpen, UserCheck, Send, Link as LinkIcon, Copy, ExternalLink, CheckCircle2, Circle, Eye, ChevronRight, ClipboardCheck, Camera } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { isNativeApp, nativePickImage } from "@/lib/native-bridge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SelectField } from "@/components/ui/SelectField";
import { DocumentViewerModal, type ViewerDoc } from "@/components/documents/DocumentViewerModal";

type Doc = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  tags: string[];
  clientUploaded: boolean;
  createdAt: string;
};

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

export function InvestorDocumentsSection({ investorId, investorName, investorPhone, investorEmail }: { investorId: string; investorName?: string; investorPhone?: string | null; investorEmail?: string | null }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerDoc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  // True only inside the mobile app's WebView — gates the native "Scan" button.
  // Resolved in an effect because `window` isn't available during SSR.
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);

  // ── KYC completeness (received vs required for the client type) ──
  type CompItem = { key: string; label: string; required: boolean; received: boolean };
  type Comp = { clientType: string; items: CompItem[]; requiredTotal: number; requiredReceived: number; missingRequired: string[]; pct: number; extraCount: number };
  const [comp, setComp] = useState<Comp | null>(null);
  const [compType, setCompType] = useState<string>("");
  const [showComp, setShowComp] = useState(false);

  async function loadCompleteness(typeOverride?: string) {
    try {
      const qs = typeOverride ? `?clientType=${typeOverride}` : "";
      const res = await fetch(`/api/investors/${investorId}/doc-completeness${qs}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setComp(j);
        if (!compType) setCompType(j.clientType);
      }
    } catch {
      /* advisory */
    }
  }

  async function load() {
    try {
      const res = await fetch(`/api/investors/${investorId}/documents`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) setDocs(Array.isArray(j.documents) ? j.documents : []);
      void loadCompleteness(compType || undefined);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investorId]);

  // When linked from the Documents vault with #documents, scroll this section
  // into view (the element renders client-side, so the native hash jump misses).
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#documents") return;
    const el = document.getElementById("documents");
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      return () => clearTimeout(t);
    }
  }, []);

  // Thin adapter for the hidden <input type=file> onChange.
  function onFiles(files: FileList | null) {
    if (files && files.length) void uploadFiles(Array.from(files));
  }

  // Capture a document with the native camera (mobile app only) and push it
  // through the exact same upload path as a picked file.
  async function onScan() {
    const file = await nativePickImage({ source: "camera" });
    if (file) await uploadFiles([file]);
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name} is over 15 MB`, "Too large");
          continue;
        }
        const ct = file.type || "application/octet-stream";
        // 1. Upload through our server to S3 (no bucket CORS, no presigned
        //    signed-header replay). Returns the storage key.
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "kyc");
        fd.append("docType", "kyc");
        if (investorName) fd.append("clientName", investorName);
        const up = await fetch("/api/compliance/upload", { method: "POST", body: fd })
          .then((r) => r.json())
          .catch(() => ({}));
        if (!up?.key) {
          toast.error(up?.error ?? "Could not upload", "Upload failed");
          continue;
        }
        // 2. register against this client
        const reg = await fetch(`/api/investors/${investorId}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, storageKey: up.key, mimeType: up.contentType ?? ct, sizeBytes: up.sizeBytes ?? file.size, category: "kyd" }),
        });
        if (reg.ok) ok += 1;
        else {
          const j = await reg.json().catch(() => ({}));
          toast.error(j.error ?? `Could not save ${file.name}`, "Upload failed");
        }
      }
      if (ok > 0) {
        toast.success(`${ok} document${ok === 1 ? "" : "s"} uploaded`);
        load();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(d: Doc) {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents/download?docId=${d.id}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) window.open(j.url, "_blank", "noopener,noreferrer");
      else toast.error(j.error ?? "Could not open document", "Download failed");
    } finally {
      setBusyId(null);
    }
  }

  // View opens the file inline in an in-app pop-up modal (PDF/image preview)
  // rather than a new browser tab.
  async function view(d: Doc) {
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents/download?docId=${d.id}&inline=1`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) {
        setViewer({ name: d.name, mimeType: d.mimeType, src: j.url, onDownload: () => download(d) });
      } else {
        toast.error(j.error ?? "Could not open document", "View failed");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(docId: string) {
    setBusyId(docId);
    try {
      const res = await fetch(`/api/investors/${investorId}/documents?docId=${docId}`, { method: "DELETE" });
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

  // ── Request documents from the client — mints a secure investor doc-collection link ──
  const [showReq, setShowReq] = useState(false);
  const [reqType, setReqType] = useState<"individual" | "huf" | "nri" | "minor" | "company" | "trust">("individual");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqLink, setReqLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function requestDocs() {
    setReqBusy(true);
    setReqErr(null);
    setReqLink(null);
    try {
      const { getChecklist } = await import("@/lib/onboarding/doc-checklists");
      const requiredDocs = getChecklist(reqType);
      const r = await fetch("/api/share-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "document_collection",
          subjectType: "investor",
          subjectId: investorId,
          expiresInDays: 7,
          payload: { requiredDocs, clientType: reqType },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReqLink({ url: data.url, expiresAt: new Date(data.expiresAt).toLocaleString("en-IN") });
    } catch (e: any) {
      setReqErr(e?.message ?? "Failed to create link");
    } finally {
      setReqBusy(false);
    }
  }

  async function copyLink() {
    if (!reqLink) return;
    await navigator.clipboard.writeText(reqLink.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // The link is SENT from the server through the comms pipeline (approved
  // WhatsApp template, branded email) — not by handing the RM a wa.me or
  // mailto: URL that leaves the CRM and logs nothing.
  const [sending, setSending] = useState<"whatsapp" | "email" | null>(null);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendLink(channel: "whatsapp" | "email") {
    if (!reqLink) return;
    setSending(channel);
    setSendMsg(null);
    try {
      const r = await fetch("/api/client-forms/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectType: "investor",
          subjectId: investorId,
          kind: "document_collection",
          channel,
          url: reqLink.url,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSendMsg({ ok: false, text: j?.error ?? `Could not send (HTTP ${r.status})` });
        return;
      }
      setSendMsg({
        ok: !!j.ok,
        text: [j.summary, j.templateNote].filter(Boolean).join(" · ") || (j.ok ? "Sent" : "Not sent"),
      });
    } catch (e: any) {
      setSendMsg({ ok: false, text: e?.message ?? "Network error" });
    } finally {
      setSending(null);
    }
  }


  const clientDocs = docs.filter((d) => d.clientUploaded);
  const teamDocs = docs.filter((d) => !d.clientUploaded);

  return (
    <div id="documents" className="card-surface p-5 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <FolderOpen className="size-4 text-brand-cyan" /> Documents &amp; attachments
          {docs.length > 0 && <span className="chip text-[10px] bg-secondary">{docs.length}</span>}
        </h3>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
          />
          <button
            type="button"
            onClick={() => setShowReq((v) => !v)}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
          >
            <Send className="size-4" /> Request from client
          </button>
          {native && (
            <button
              type="button"
              disabled={uploading}
              onClick={onScan}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Camera className="size-4" /> Scan
            </button>
          )}
        </div>
      </div>

      {/* KYC completeness */}
      {comp && (comp.requiredTotal > 0) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/10 p-3">
          <button
            type="button"
            onClick={() => setShowComp((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
            aria-expanded={showComp}
          >
            <ChevronRight className={`size-3.5 text-muted-foreground shrink-0 transition-transform ${showComp ? "rotate-90" : ""}`} />
            <ClipboardCheck className={`size-4 ${comp.pct === 100 ? "text-emerald-600" : "text-amber-600"}`} />
            <span className="text-sm font-semibold">KYC completeness</span>
            <span className={`text-xs font-bold ${comp.pct === 100 ? "text-emerald-700" : "text-amber-700"}`}>
              {comp.requiredReceived}/{comp.requiredTotal} required
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden max-w-[160px] ml-1">
              <div className={`h-full ${comp.pct === 100 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${comp.pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{comp.pct}%</span>
          </button>
          {!showComp && comp.missingRequired.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-1.5 pl-6">Missing: {comp.missingRequired.join(", ")}</p>
          )}
          {showComp && (
            <div className="mt-3 space-y-2 pl-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Client type:</span>
                <SelectField
                  value={compType}
                  onChange={(e) => { setCompType(e.target.value); void loadCompleteness(e.target.value); }}
                  size="sm"
                  className="w-40"
                >
                  <option value="individual">Individual</option>
                  <option value="huf">HUF</option>
                  <option value="nri">NRI</option>
                  <option value="minor">Minor</option>
                  <option value="company">Company</option>
                  <option value="trust">Trust</option>
                </SelectField>
                {comp.extraCount > 0 && <span className="text-[11px] text-muted-foreground">· {comp.extraCount} other doc(s)</span>}
              </div>
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {comp.items.map((it) => (
                  <li key={it.key} className="flex items-center gap-1.5 text-xs">
                    {it.received ? <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" /> : <Circle className={`size-3.5 shrink-0 ${it.required ? "text-amber-500" : "text-muted-foreground/40"}`} />}
                    <span className={it.received ? "text-foreground" : it.required ? "text-amber-700" : "text-muted-foreground"}>
                      {it.label}{!it.required && <span className="text-muted-foreground/60"> (optional)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showReq && (
        <div className="mb-4 rounded-lg border border-brand-cyan/30 bg-brand-cyan-light/20 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-cyan-deep flex items-center gap-1.5">
            <LinkIcon className="size-3.5" /> Send a secure document-collection link
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pick the client type — it drives which KYC documents are requested. The client uploads from
            WhatsApp / email and the files appear here automatically.
          </p>
          {!reqLink ? (
            <>
              <SelectField
                value={reqType}
                onChange={(e) => setReqType(e.target.value as any)}
                size="sm"
                className="w-full"
              >
                <option value="individual">Individual / Resident</option>
                <option value="huf">HUF (Hindu Undivided Family)</option>
                <option value="nri">NRI (Non-Resident Indian)</option>
                <option value="minor">Minor (Below 18)</option>
                <option value="company">Company / Corporate</option>
                <option value="trust">Trust</option>
              </SelectField>
              {reqErr && <div className="text-xs text-rose-700">{reqErr}</div>}
              <div className="flex gap-2">
                <button
                  onClick={requestDocs}
                  disabled={reqBusy}
                  className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {reqBusy ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Generate link
                </button>
                <button onClick={() => setShowReq(false)} className="btn-ghost text-xs">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-emerald-300 bg-emerald-50/50 p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                <CheckCircle2 className="size-4" /> Link ready · expires {reqLink.expiresAt}
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={reqLink.url}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 border rounded-md px-2 py-1.5 text-xs font-mono bg-white"
                />
                <button onClick={copyLink} className="rounded-md border bg-white px-2 text-xs flex items-center gap-1 hover:bg-secondary">
                  <Copy className="size-3" /> {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {investorPhone && (
                  <button
                    type="button"
                    onClick={() => sendLink("whatsapp")}
                    disabled={sending !== null}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    {sending === "whatsapp" ? (
                      <><Loader2 className="size-3 animate-spin" /> Sending…</>
                    ) : (
                      <>Send via WhatsApp</>
                    )}
                  </button>
                )}
                {investorEmail && (
                  <button
                    type="button"
                    onClick={() => sendLink("email")}
                    disabled={sending !== null}
                    className="btn-secondary text-xs disabled:opacity-50"
                  >
                    {sending === "email" ? (
                      <><Loader2 className="size-3 animate-spin" /> Sending…</>
                    ) : (
                      <>Send via Email</>
                    )}
                  </button>
                )}
                <a href={reqLink.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
                  Preview <ExternalLink className="size-3" />
                </a>
                <button onClick={() => { setReqLink(null); setSendMsg(null); }} className="btn-ghost text-xs">
                  New link
                </button>
              </div>
              {sendMsg && (
                <div
                  className={`mt-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
                    sendMsg.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {sendMsg.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Big drag-and-drop upload area — expected document types shown as chips.
          Replaces the old top-right Upload button; drop or click to browse. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !uploading) { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); onFiles(e.dataTransfer.files); }}
        className={`mb-4 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer select-none transition-colors ${
          dragActive
            ? "border-brand-cyan bg-brand-cyan-light/30"
            : "border-border hover:border-brand-cyan/50 hover:bg-secondary/20"
        } ${uploading ? "pointer-events-none opacity-70" : ""}`}
      >
        <div className="mx-auto size-12 rounded-full bg-brand-cyan-light/40 grid place-items-center">
          {uploading ? <Loader2 className="size-6 text-brand-cyan animate-spin" /> : <Upload className="size-6 text-brand-cyan" />}
        </div>
        <div className="mt-3 font-semibold text-sm">
          {uploading ? "Uploading…" : dragActive ? "Drop to upload" : "Drag & drop documents here"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          or <span className="text-brand-cyan-deep font-medium">click to browse</span> · PDF, JPG, PNG, DOC, XLS · up to 15 MB each
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground pb-1">
          No documents yet — files {investorName ?? "the client"} submits via the required-documents link appear here automatically.
        </p>
      ) : (
        <div className="space-y-5">
          {clientDocs.length > 0 && (
            <DocGroup
              title="Client-uploaded (required documents)"
              icon={UserCheck}
              docs={clientDocs}
              busyId={busyId}
              onView={view}
              onDownload={download}
              onDelete={(id) => setConfirmId(id)}
            />
          )}
          <DocGroup
            title={clientDocs.length > 0 ? "Added by your team" : "All documents"}
            icon={FileText}
            docs={teamDocs}
            emptyHint={teamDocs.length === 0 ? "Nothing added by the team yet." : undefined}
            busyId={busyId}
            onView={view}
            onDownload={download}
            onDelete={(id) => setConfirmId(id)}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!confirmId}
        title="Delete document?"
        message="This permanently removes the file from this client's record."
        confirmLabel="Delete"
        tone="danger"
        busy={busyId === confirmId}
        onConfirm={() => confirmId && doDelete(confirmId)}
        onCancel={() => setConfirmId(null)}
      />

      <DocumentViewerModal doc={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

function DocGroup({
  title,
  icon: Icon,
  docs,
  emptyHint,
  busyId,
  onView,
  onDownload,
  onDelete,
}: {
  title: string;
  icon: any;
  docs: Doc[];
  emptyHint?: string;
  busyId: string | null;
  onView: (d: Doc) => void;
  onDownload: (d: Doc) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2 hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={`size-3.5 shrink-0 transition-transform duration-300 ${open ? "rotate-90" : ""}`} />
        <Icon className="size-3.5" /> <span>{title}</span>
        <span className="ml-1 rounded-full bg-secondary px-1.5 text-[9px] font-bold">{docs.length}</span>
      </button>
      <div className={`grid transition-all duration-300 ease-in-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden pb-0.5">
          {emptyHint ? (
            <div className="text-xs text-muted-foreground/70 px-1 py-2">{emptyHint}</div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-brand-cyan-light/20 transition-colors">
              <FileText className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="capitalize">{d.category === "kyd" ? "KYC" : d.category.replace(/_/g, " ")}</span>
                  {fmtSize(d.sizeBytes) && <span>· {fmtSize(d.sizeBytes)}</span>}
                  {fmtDate(d.createdAt) && <span>· {fmtDate(d.createdAt)}</span>}
                  {d.clientUploaded && <span className="chip text-[9px] bg-emerald-50 text-emerald-700">client</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onView(d)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                title="View"
              >
                {busyId === d.id ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => onDownload(d)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
                title="Download"
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(d.id)}
                disabled={busyId === d.id}
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
