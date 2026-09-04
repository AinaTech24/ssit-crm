"use client";

/**
 * Edit an existing content-library asset's metadata, schedule and co-branding.
 * The file itself isn't replaced here — to swap the file, upload a new asset.
 * For images it shows a live co-branded preview (branded endpoint).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Image as ImageIcon, Loader2, Save, Calendar, Palette, Tag } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

const TYPES: [string, string][] = [["image", "Image"], ["pdf", "PDF"], ["article", "Article / Markdown"], ["presentation", "Presentation"], ["video", "Video"], ["audio", "Audio"], ["other", "Other"]];
const CATEGORIES: [string, string][] = [["festive", "Festive"], ["market_update", "Market update"], ["investor_education", "Investor education"], ["scheme_recommendation", "Scheme recommendation"], ["tax_planning", "Tax planning"], ["retirement", "Retirement"], ["child_education", "Child education"], ["wealth_creation", "Wealth creation"], ["sebi_compliance", "SEBI / compliance"], ["general", "General"]];

export type AssetInitial = {
  id: string;
  title: string;
  description: string;
  type: string;
  category: string;
  thumbnailUrl: string;
  tags: string[];
  isActive: boolean;
  publishAt: string;
  expireAt: string;
  branding: { position?: string; heightPct?: number; background?: string };
};

export function AssetEditForm({ asset }: { asset: AssetInitial }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: asset.title,
    description: asset.description,
    type: asset.type,
    category: asset.category,
    tagsCsv: (asset.tags ?? []).join(", "),
    isActive: asset.isActive,
    publishAt: asset.publishAt,
    expireAt: asset.expireAt,
    bPosition: asset.branding?.position ?? "bottom",
    bHeight: asset.branding?.heightPct ?? 14,
    bBackground: asset.branding?.background ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const branding: any = { position: f.bPosition, heightPct: Number(f.bHeight) };
      if (f.bBackground.trim()) branding.background = f.bBackground.trim();
      const res = await fetch(`/api/content-library/${asset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: f.title,
          description: f.description || undefined,
          type: f.type,
          category: f.category,
          tags: f.tagsCsv.split(",").map((t) => t.trim()).filter(Boolean),
          isActive: f.isActive,
          publishAt: f.publishAt || undefined,
          expireAt: f.expireAt || undefined,
          brandingConfig: f.type === "image" ? branding : undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      router.push("/super-admin/content-library");
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/super-admin/content-library" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to library
      </Link>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-5 text-white" style={{ background: "linear-gradient(135deg, hsl(221 72% 20%) 0%, hsl(221 76% 13%) 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-white/15 grid place-items-center"><ImageIcon className="size-5" /></div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Edit asset</h1>
              <p className="text-xs text-white/75">Update details, schedule and co-branding.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Preview */}
          <div className="flex gap-4">
            <div className="w-40 shrink-0">
              <div className="aspect-video rounded-lg border border-border bg-secondary/40 overflow-hidden grid place-items-center">
                {asset.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.type === "image" ? `/api/content-library/${asset.id}/branded?mode=preview` : asset.thumbnailUrl} alt="" className="object-cover w-full h-full" />
                ) : <ImageIcon className="size-8 text-muted-foreground/40" />}
              </div>
              {asset.type === "image" && <p className="text-[10px] text-muted-foreground mt-1 text-center">Co-branded preview (your tenant)</p>}
            </div>
            <div className="flex-1 space-y-3">
              <div><Label>Title</Label><input value={f.title} onChange={(e) => set("title", e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 rounded" />
                Active (visible to MFDs)
              </label>
            </div>
          </div>

          <Section icon={Tag} title="Classification">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Type</Label><SelectField value={f.type} onChange={(e) => set("type", e.target.value)} className="w-full">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField></div>
              <div><Label>Category</Label><SelectField value={f.category} onChange={(e) => set("category", e.target.value)} className="w-full">{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField></div>
            </div>
            <div><Label>Description</Label><textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
            <div><Label>Tags (comma-separated)</Label><input value={f.tagsCsv} onChange={(e) => set("tagsCsv", e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
          </Section>

          <Section icon={Calendar} title="Schedule">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Publish on</Label><DateField value={f.publishAt} onChange={(e) => set("publishAt", e.target.value)} className="w-full" /></div>
              <div><Label>Expire on</Label><DateField value={f.expireAt} onChange={(e) => set("expireAt", e.target.value)} className="w-full" /></div>
            </div>
          </Section>

          {f.type === "image" && (
            <Section icon={Palette} title="Co-branding strip">
              <div className="grid sm:grid-cols-3 gap-3">
                <div><Label>Position</Label><SelectField value={f.bPosition} onChange={(e) => set("bPosition", e.target.value)} className="w-full"><option value="bottom">Bottom</option><option value="top">Top</option><option value="both">Top &amp; bottom</option></SelectField></div>
                <div><Label>Height (%)</Label><input type="number" min={5} max={50} value={f.bHeight} onChange={(e) => set("bHeight", Number(e.target.value))} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
                <div><Label>Background (hex)</Label><input value={f.bBackground} onChange={(e) => set("bBackground", e.target.value)} placeholder="brand default" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
              </div>
            </Section>
          )}

          {err && <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{err}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Link href="/super-admin/content-library" className="rounded-lg border px-4 py-2 text-sm hover:bg-accent transition">Cancel</Link>
            <button onClick={save} disabled={busy} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {busy ? "Saving…" : "Save changes"}
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
