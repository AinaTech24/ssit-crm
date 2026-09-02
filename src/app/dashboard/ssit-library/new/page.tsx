"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Upload,
  Loader2,
  Save,
  Image as ImageIcon,
  Link2,
} from "lucide-react";

const TYPES: [string, string][] = [
  ["image", "Image (poster / creative)"],
  ["pdf", "PDF"],
  ["article", "Article / Markdown"],
  ["presentation", "Presentation"],
  ["video", "Video"],
  ["audio", "Audio"],
  ["other", "Other"],
];

const CATEGORIES: [string, string][] = [
  ["festive", "Festive"],
  ["market_update", "Market update"],
  ["investor_education", "Investor education"],
  ["scheme_recommendation", "Scheme recommendation"],
  ["tax_planning", "Tax planning"],
  ["retirement", "Retirement"],
  ["child_education", "Child education"],
  ["wealth_creation", "Wealth creation"],
  ["sebi_compliance", "SEBI / compliance"],
  ["general", "General"],
];

export default function NewCustomAssetPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "image",
    category: "festive",
    fileUrl: "",
    thumbnailUrl: "",
    tagsCsv: "",
  });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function handleFilePicked(file: File) {
    setUploading(true);
    setErr(null);
    try {
      // 1. Get presigned URL
      const presign = await fetch("/api/content-library/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      const pj = await presign.json();
      if (!presign.ok) {
        setErr(pj.error ?? "Could not get upload URL");
        return;
      }
      // 2. PUT to S3
      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) {
        setErr(`Upload failed (HTTP ${put.status}). Make sure S3 CORS is correct.`);
        return;
      }
      // 3. Set the public URL on the form
      set("fileUrl", pj.publicUrl);
      if (form.type === "image" && !form.thumbnailUrl) set("thumbnailUrl", pj.publicUrl);
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form.title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (!form.fileUrl.trim()) {
      setErr("Upload a file or paste a file URL first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/content-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          type: form.type,
          category: form.category,
          fileUrl: form.fileUrl,
          thumbnailUrl: form.thumbnailUrl || form.fileUrl,
          tags: form.tagsCsv
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/ssit-library`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        href="/dashboard/ssit-library"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to library
      </Link>

      <div>
        <h1 className="page-title">
          <ImageIcon className="size-6 text-brand-cyan" /> Upload custom asset
        </h1>
      </div>

      <div className="card-surface p-5 space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Title <span className="text-rose-600">*</span>
          </div>
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Custom Diwali Flyer"
            className="input-base"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description</div>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            placeholder="Description visible to your firm's team."
            className="input-base"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Type</div>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="input-base"
            >
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Category</div>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className="input-base"
            >
              {CATEGORIES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Tags (comma-separated)</div>
          <input
            value={form.tagsCsv}
            onChange={(e) => set("tagsCsv", e.target.value)}
            placeholder="diwali, custom, seasonal"
            className="input-base"
          />
        </label>
      </div>

      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="size-4 text-brand-cyan" />
          <h2 className="section-title">File</h2>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Upload from your computer</div>
          <input
            type="file"
            accept="image/*,application/pdf,.ppt,.pptx,.doc,.docx,.md,video/*,audio/*"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFilePicked(f);
            }}
            className="block text-xs"
          />
          {uploading && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Uploading to S3…
            </div>
          )}
        </label>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Link2 className="size-3" /> Or paste a public URL:
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">
            File URL <span className="text-rose-600">*</span>
          </div>
          <input
            value={form.fileUrl}
            onChange={(e) => set("fileUrl", e.target.value)}
            placeholder="https://…"
            className="input-base"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Thumbnail URL (optional)</div>
          <input
            value={form.thumbnailUrl}
            onChange={(e) => set("thumbnailUrl", e.target.value)}
            placeholder="Defaults to the file URL for images."
            className="input-base"
          />
        </label>

        {form.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.thumbnailUrl}
            alt="preview"
            className="max-h-48 rounded-lg border border-border"
          />
        )}

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/ssit-library" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !form.title || !form.fileUrl}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save custom asset"}
          </button>
        </div>
      </div>
    </div>
  );
}
