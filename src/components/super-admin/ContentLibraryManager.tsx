"use client";

/**
 * Platform-admin content-library management surface — search, filter
 * (type / category / status), live/scheduled/expired/inactive badges, per-asset
 * usage counts, and hover actions (edit · activate/deactivate · delete).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, Image as ImageIcon, FileText, Presentation, Video, Music, File,
  Pencil, Eye, EyeOff, Trash2, Download, Share2, Sparkles, Loader2,
} from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export type AssetRow = {
  id: string;
  title: string | null;
  description: string | null;
  type: string;
  category: string | null;
  thumbnailUrl: string | null;
  isActive: boolean;
  source: string | null;
  publishAt: string | null;
  expireAt: string | null;
  createdAt: string | null;
  fileSizeBytes: number | null;
  cobrands: number;
  downloads: number;
  sends: number;
};

const TYPE_ICON: Record<string, any> = { image: ImageIcon, pdf: FileText, article: FileText, presentation: Presentation, video: Video, audio: Music, other: File };
const TYPE_TONE: Record<string, string> = {
  image: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  pdf: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  article: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  presentation: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  video: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  audio: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300",
};

const CATEGORIES = ["festive", "market_update", "investor_education", "scheme_recommendation", "tax_planning", "retirement", "child_education", "wealth_creation", "sebi_compliance", "general"];
const TYPES = ["image", "pdf", "article", "presentation", "video", "audio", "other"];

function statusOf(a: AssetRow): { label: string; tone: string } {
  const now = Date.now();
  if (!a.isActive) return { label: "Inactive", tone: "bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300" };
  if (a.expireAt && new Date(a.expireAt).getTime() <= now) return { label: "Expired", tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" };
  if (a.publishAt && new Date(a.publishAt).getTime() > now) return { label: "Scheduled", tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  return { label: "Live", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function ContentLibraryManager({ assets }: { assets: AssetRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<AssetRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (type && a.type !== type) return false;
      if (category && a.category !== category) return false;
      if (status && statusOf(a).label.toLowerCase() !== status) return false;
      if (needle && !(`${a.title ?? ""} ${a.description ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [assets, q, type, category, status]);

  async function toggleActive(a: AssetRow) {
    setBusyId(a.id);
    try {
      await fetch(`/api/content-library/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !a.isActive }),
      });
      router.refresh();
    } finally { setBusyId(null); }
  }

  async function hardDelete(a: AssetRow) {
    setBusyId(a.id);
    try {
      await fetch(`/api/content-library/${a.id}?hard=1`, { method: "DELETE" });
      setConfirmDel(null);
      router.refresh();
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or description…" className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm" />
        </div>
        <SelectField value={type} onChange={(e) => setType(e.target.value)} className="w-40" placeholder="All types">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </SelectField>
        <SelectField value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" placeholder="All categories">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </SelectField>
        <SelectField value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" placeholder="Any status">
          <option value="">Any status</option>
          <option value="live">Live</option>
          <option value="scheduled">Scheduled</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </SelectField>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} of {assets.length} assets</div>

      {filtered.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">No assets match these filters.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((a) => {
            const Icon = TYPE_ICON[a.type] ?? File;
            const st = statusOf(a);
            return (
              <div key={a.id} className={`group card-surface overflow-hidden flex flex-col ${!a.isActive ? "opacity-70" : ""}`}>
                <div className="relative aspect-video bg-secondary/40 grid place-items-center overflow-hidden">
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt={a.title ?? ""} className="object-cover w-full h-full" />
                  ) : (
                    <Icon className="size-10 text-muted-foreground/50" />
                  )}
                  <span className={`absolute top-2 left-2 chip text-[10px] font-medium ${st.tone}`}>{st.label}</span>
                  {/* Hover actions */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link href={`/super-admin/content-library/${a.id}/edit`} title="Edit" className="size-7 grid place-items-center rounded-md bg-card/90 backdrop-blur shadow hover:bg-card text-foreground"><Pencil className="size-3.5" /></Link>
                    <button onClick={() => toggleActive(a)} disabled={busyId === a.id} title={a.isActive ? "Deactivate" : "Activate"} className="size-7 grid place-items-center rounded-md bg-card/90 backdrop-blur shadow hover:bg-card text-foreground">
                      {busyId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : a.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <button onClick={() => setConfirmDel(a)} title="Delete permanently" className="size-7 grid place-items-center rounded-md bg-card/90 backdrop-blur shadow hover:bg-rose-50 text-rose-600"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
                <div className="p-3 space-y-1.5 flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`chip text-[10px] ${TYPE_TONE[a.type] ?? ""}`}>{a.type}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(a.createdAt)}</span>
                  </div>
                  <div className="font-semibold text-sm leading-tight">{a.title ?? "Untitled"}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{(a.category ?? "general").replace(/_/g, " ")}</div>
                  {/* Usage */}
                  <div className="mt-auto flex items-center gap-3 pt-1.5 text-[11px] text-muted-foreground border-t border-border/60">
                    <span className="inline-flex items-center gap-1" title="Co-brands"><Sparkles className="size-3" /> {a.cobrands}</span>
                    <span className="inline-flex items-center gap-1" title="Downloads"><Download className="size-3" /> {a.downloads}</span>
                    <span className="inline-flex items-center gap-1" title="Sends"><Share2 className="size-3" /> {a.sends}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title={`Permanently delete "${confirmDel?.title ?? "asset"}"?`}
        message="This removes the asset and its usage history for good. To hide it from MFDs without deleting, use Deactivate instead."
        confirmLabel={busyId ? "Deleting…" : "Delete permanently"}
        cancelLabel="Cancel"
        tone="danger"
        busy={!!busyId}
        onConfirm={() => confirmDel && hardDelete(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
