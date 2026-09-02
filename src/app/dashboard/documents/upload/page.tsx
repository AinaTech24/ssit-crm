"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Upload, Loader2, X, FileText, Sparkles } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { InvestorLookup } from "@/components/common/InvestorLookup";

const CATEGORIES = [
  { key: "arn", label: "ARN" },
  { key: "euin", label: "EUIN" },
  { key: "nism", label: "NISM Certificate" },
  { key: "kyd", label: "KYD Document" },
  { key: "amc_empanelment", label: "AMC Empanelment" },
  { key: "ddq", label: "DDQ Document" },
  { key: "sop", label: "SOP" },
  { key: "marketing_approval", label: "Marketing Approval" },
  { key: "complaint", label: "Complaint Document" },
  { key: "audit_report", label: "Audit Report" },
  { key: "ria_compliance", label: "RIA Compliance" },
  { key: "other", label: "Other" },
];

export default function UploadDocumentPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", category: "other", description: "", expiresOn: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Auto-fill expiry / name from a single document (text-layer or OCR; no AI cost).
  async function scan() {
    if (files.length !== 1) return;
    setScanning(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", files[0]);
      const res = await fetch("/api/documents/extract", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Couldn't read the document");
        return;
      }
      setForm((f) => ({
        ...f,
        expiresOn: j.expiry || f.expiresOn,
        name: f.name || files[0].name,
      }));
      if (!j.expiry && !j.pan) setErr("No expiry or PAN found to auto-fill — enter details manually.");
    } finally {
      setScanning(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setErr("Choose at least one file");
      return;
    }
    setBusy(true);
    setErr(null);
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : null);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "compliance");
        fd.append("docType", form.category || "compliance");
        if (client?.name) fd.append("clientName", client.name);
        const upRes = await fetch("/api/compliance/upload", { method: "POST", body: fd });
        const upJson = await upRes.json().catch(() => ({}));
        if (!upRes.ok || !upJson.key) {
          setErr(upJson.error ?? `Upload failed for ${file.name} (HTTP ${upRes.status})`);
          break;
        }
        // Single upload → use the typed name; batch → each file keeps its own name.
        const docName = files.length === 1 ? form.name || file.name : file.name;
        const regRes = await fetch("/api/compliance/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: docName,
            category: form.category,
            description: form.description,
            storageKey: upJson.key,
            mimeType: upJson.contentType ?? file.type,
            sizeBytes: upJson.sizeBytes ?? file.size,
            expiresOn: form.expiresOn || undefined,
            relatedEntityType: client ? "investor" : undefined,
            relatedEntityId: client?.id,
          }),
        });
        if (!regRes.ok) {
          const regJson = await regRes.json().catch(() => ({}));
          setErr(regJson.error ?? `Register failed for ${file.name}`);
          break;
        }
        ok += 1;
      }
      if (ok === files.length) {
        router.push("/dashboard/documents");
        router.refresh();
      }
    } catch (e: any) {
      setErr(e?.message ? `Upload error: ${e.message}` : "Upload failed unexpectedly");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Link href="/dashboard/documents" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to documents
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Upload document{files.length > 1 ? "s" : ""}</h1>
      <p className="text-sm text-muted-foreground">Files are stored encrypted in S3 (ap-south-1, DPDP-compliant). Drag &amp; drop multiple files to batch-upload them under one category.</p>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-4">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          className={`block border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${dragOver ? "border-brand-cyan bg-brand-cyan/5" : "hover:bg-accent/40"}`}
        >
          <input type="file" multiple onChange={(e) => addFiles(e.target.files)} className="hidden" />
          <Upload className="size-8 mx-auto text-muted-foreground" />
          <div className="mt-2 text-sm font-medium">{files.length ? "Add more files" : "Choose files or drag & drop"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">PDF, image, or document — multiple allowed</div>
        </label>

        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 bg-background">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-rose-600 p-0.5"><X className="size-4" /></button>
              </div>
            ))}
            {files.length === 1 && (
              <button type="button" onClick={scan} disabled={scanning} className="btn-secondary text-xs inline-flex items-center gap-1.5 mt-1">
                {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-brand-cyan" />}
                Auto-fill expiry from document
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.length <= 1 && (
            <label className="block">
              <div className="text-xs font-medium mb-1">Document name</div>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={files[0]?.name ?? ""} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
            </label>
          )}
          <label className="block">
            <div className="text-xs font-medium mb-1">Category {files.length > 1 && <span className="text-muted-foreground font-normal">(applies to all)</span>}</div>
            <SelectField value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Expires on</div>
            <DateField value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className="w-full" />
          </label>
          <label className="block sm:col-span-2">
            <div className="text-xs font-medium mb-1">Link to a client <span className="text-muted-foreground font-normal">(optional — for KYC / client documents)</span></div>
            <InvestorLookup
              value={client?.id}
              displayName={client?.name}
              onSelect={(id, name) => setClient({ id, name })}
              onClear={() => setClient(null)}
              placeholder="Search client by name, PAN, or mobile…"
            />
            <div className="text-[11px] text-muted-foreground mt-1">Tag the client this document belongs to, so you can see it in the vault.</div>
          </label>
          <label className="block sm:col-span-2 lg:col-span-1">
            <div className="text-xs font-medium mb-1">Notes</div>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
        </div>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end items-center gap-2 pt-2 border-t">
          {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
          <Link href="/dashboard/documents" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || files.length === 0} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? "Uploading…" : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
