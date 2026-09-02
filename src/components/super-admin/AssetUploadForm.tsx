"use client";

/**
 * Upload one or more content-library assets in a single pass. Each picked file
 * is uploaded to S3 (presigned PUT), its real size/mime — and, for images,
 * pixel dimensions — captured, and turned into its own asset sharing the chosen
 * category / tags / schedule / branding. Titles default to the filename and are
 * editable per file.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Image as ImageIcon, Loader2, Save, UploadCloud, X, Calendar, Palette, Tag } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

const TYPES: [string, string][] = [["image", "Image (poster / creative)"], ["pdf", "PDF"], ["article", "Article / Markdown"], ["presentation", "Presentation"], ["video", "Video"], ["audio", "Audio"], ["other", "Other"]];
const CATEGORIES: [string, string][] = [["festive", "Festive"], ["market_update", "Market update"], ["investor_education", "Investor education"], ["scheme_recommendation", "Scheme recommendation"], ["tax_planning", "Tax planning"], ["retirement", "Retirement"], ["child_education", "Child education"], ["wealth_creation", "Wealth creation"], ["sebi_compliance", "SEBI / compliance"], ["general", "General"]];

type PickedFile = {
  key: string;
  title: string;
  fileUrl: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  uploading: boolean;
  error?: string;
};

function inferType(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  return "other";
}

function imageDims(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve({});
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function AssetUploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [type, setType] = useState("image");
  const [category, setCategory] = useState("festive");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [expireAt, setExpireAt] = useState("");
  const [bPosition, setBPosition] = useState("bottom");
  const [bHeight, setBHeight] = useState(14);
  const [bBackground, setBBackground] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setErr(null);
    if (type === "image" && picked[0] && !picked[0].type.startsWith("image/")) setType(inferType(picked[0].type));
    for (const file of Array.from(picked)) {
      const key = `${file.name}-${file.size}-${Math.round(performance.now())}`;
      const base: PickedFile = {
        key,
        title: file.name.replace(/\.[^.]+$/, ""),
        fileUrl: "",
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
        uploading: true,
      };
      setFiles((f) => [...f, base]);
      try {
        const dims = await imageDims(file);
        const presign = await fetch("/api/content-library/upload-url", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
        });
        const pj = await presign.json();
        if (!presign.ok) throw new Error(pj.error ?? "Could not get upload URL");
        const put = await fetch(pj.url, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
        if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
        setFiles((f) => f.map((x) => x.key === key ? { ...x, uploading: false, fileUrl: pj.publicUrl, thumbnailUrl: file.type.startsWith("image/") ? pj.publicUrl : undefined, ...dims } : x));
      } catch (e: any) {
        setFiles((f) => f.map((x) => x.key === key ? { ...x, uploading: false, error: e?.message ?? "Upload failed" } : x));
      }
    }
  }

  const ready = files.filter((f) => f.fileUrl && !f.uploading);
  const anyUploading = files.some((f) => f.uploading);

  async function saveAll() {
    if (ready.length === 0) { setErr("Add at least one file."); return; }
    setBusy(true);
    setErr(null);
    const tags = tagsCsv.split(",").map((t) => t.trim()).filter(Boolean);
    const branding: any = { position: bPosition, heightPct: bHeight };
    if (bBackground.trim()) branding.background = bBackground.trim();
    try {
      for (const f of ready) {
        const res = await fetch("/api/content-library", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: f.title || f.fileName,
            description: description || undefined,
            type,
            category,
            fileUrl: f.fileUrl,
            fileName: f.fileName,
            fileSizeBytes: f.sizeBytes,
            mimeType: f.mimeType,
            width: f.width,
            height: f.height,
            thumbnailUrl: f.thumbnailUrl ?? f.fileUrl,
            tags,
            brandingConfig: type === "image" ? branding : undefined,
            publishAt: publishAt || undefined,
            expireAt: expireAt || undefined,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(`${f.title}: ${j.error ?? `save failed (${res.status})`}`);
        }
      }
      router.push("/super-admin/content-library");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/super-admin/content-library" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to library
      </Link>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-5 text-white" style={{ background: "linear-gradient(135deg, hsl(358 75% 41%) 0%, hsl(358 78% 30%) 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-white/15 grid place-items-center"><ImageIcon className="size-5" /></div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Upload asset(s)</h1>
              <p className="text-xs text-white/75">Drop one or many creatives — every MFD can co-brand and share them.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Dropzone */}
          <div>
            <label className="block rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition cursor-pointer p-8 text-center">
              <UploadCloud className="size-8 mx-auto text-muted-foreground" />
              <div className="mt-2 text-sm font-medium">Click to choose files</div>
              <div className="text-xs text-muted-foreground">Images, PDFs, presentations, video, audio · multiple allowed</div>
              <input type="file" multiple accept="image/*,application/pdf,.ppt,.pptx,.doc,.docx,.md,video/*,audio/*" className="hidden" onChange={(e) => onPick(e.target.files)} />
            </label>
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((f) => (
                  <div key={f.key} className="flex items-center gap-3 rounded-lg border border-border p-2">
                    <div className="size-12 rounded-md bg-secondary/40 overflow-hidden grid place-items-center shrink-0">
                      {f.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.thumbnailUrl} alt="" className="object-cover w-full h-full" />
                      ) : <ImageIcon className="size-5 text-muted-foreground/50" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <input value={f.title} onChange={(e) => setFiles((fs) => fs.map((x) => x.key === f.key ? { ...x, title: e.target.value } : x))} className="w-full rounded border border-border bg-background px-2 py-1 text-sm" />
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {f.uploading ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> uploading…</span>
                          : f.error ? <span className="text-rose-600">{f.error}</span>
                          : <>{(f.sizeBytes / 1024 / 1024).toFixed(2)} MB{f.width ? ` · ${f.width}×${f.height}` : ""} · {f.mimeType}</>}
                      </div>
                    </div>
                    <button onClick={() => setFiles((fs) => fs.filter((x) => x.key !== f.key))} className="text-muted-foreground hover:text-rose-600 shrink-0 p-1"><X className="size-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shared settings */}
          <Section icon={Tag} title="Classification">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Type</Label><SelectField value={type} onChange={(e) => setType(e.target.value)} className="w-full">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField></div>
              <div><Label>Category</Label><SelectField value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField></div>
            </div>
            <div><Label>Description (shown to MFDs)</Label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
            <div><Label>Tags (comma-separated)</Label><input value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="diwali, tax, 80c" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
          </Section>

          <Section icon={Calendar} title="Schedule (optional)">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Publish on</Label><DateField value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className="w-full" /></div>
              <div><Label>Expire on</Label><DateField value={expireAt} onChange={(e) => setExpireAt(e.target.value)} className="w-full" /></div>
            </div>
            <p className="text-[11px] text-muted-foreground">Before the publish date / after the expiry date the asset is hidden from MFDs.</p>
          </Section>

          {type === "image" && (
            <Section icon={Palette} title="Co-branding strip">
              <div className="grid sm:grid-cols-3 gap-3">
                <div><Label>Position</Label><SelectField value={bPosition} onChange={(e) => setBPosition(e.target.value)} className="w-full"><option value="bottom">Bottom</option><option value="top">Top</option><option value="both">Top &amp; bottom</option></SelectField></div>
                <div><Label>Height (% of image)</Label><input type="number" min={5} max={50} value={bHeight} onChange={(e) => setBHeight(Number(e.target.value))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
                <div><Label>Background (hex, optional)</Label><input value={bBackground} onChange={(e) => setBBackground(e.target.value)} placeholder="defaults to brand" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">Default placement for the MFD's logo + contact strip. MFDs can still pick a different preset when sharing.</p>
            </Section>
          )}

          {err && <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{err}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Link href="/super-admin/content-library" className="rounded-lg border px-4 py-2 text-sm hover:bg-accent transition">Cancel</Link>
            <button onClick={saveAll} disabled={busy || anyUploading || ready.length === 0} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {busy ? "Saving…" : ready.length > 1 ? `Save ${ready.length} assets` : "Save asset"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="size-7 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon className="size-4" /></span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground mb-1">{children}</div>;
}
