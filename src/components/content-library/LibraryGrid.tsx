"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Image as ImageIcon,
  FileText,
  Presentation,
  Video,
  Music,
  File,
  Download,
  X,
  Sparkles,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

type Asset = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  category: string;
  fileUrl: string;
  fileName: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  tenantId: string | null;
};

const TYPE_ICON: Record<string, any> = {
  image: ImageIcon,
  pdf: FileText,
  article: FileText,
  presentation: Presentation,
  video: Video,
  audio: Music,
  other: File,
};

const TYPE_TONE: Record<string, string> = {
  image: "bg-emerald-50 text-emerald-700",
  pdf: "bg-rose-50 text-rose-700",
  article: "bg-blue-50 text-blue-700",
  presentation: "bg-amber-50 text-amber-700",
  video: "bg-violet-50 text-violet-700",
  audio: "bg-cyan-50 text-cyan-700",
  other: "bg-gray-50 text-gray-700",
};

export function LibraryGrid({ rows }: { rows: Asset[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggleSelect(id: string) {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  }

  function handleBatchDownload() {
    if (selectedIds.length === 0) return;
    window.location.href = `/api/content-library/batch-download?ids=${selectedIds.join(",")}`;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map((a) => {
          const Icon = TYPE_ICON[a.type] ?? File;
          const isSelected = selectedIds.includes(a.id);
          return (
            <div
              key={a.id}
              onClick={() => toggleSelect(a.id)}
              className={`card-surface overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 block relative cursor-pointer group border ${
                isSelected ? "border-brand-cyan ring-2 ring-brand-cyan/20 bg-brand-cyan-light/10" : "border-border"
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelect(a.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-2 right-2 size-4 rounded border-gray-300 text-brand-cyan focus:ring-brand-cyan z-20 accent-brand-cyan cursor-pointer"
              />

              <Link
                href={`/dashboard/ssit-library/${a.id}`}
                onClick={(e) => e.stopPropagation()}
                className="block"
              >
                <div className="aspect-video bg-secondary/40 grid place-items-center overflow-hidden relative">
                  {a.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/content-library/${a.id}/branded?mode=preview`}
                      alt={a.title}
                      className="object-cover w-full h-full"
                    />
                  ) : a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.thumbnailUrl}
                      alt={a.title}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <Icon className="size-10 text-muted-foreground/50" />
                  )}
                  <span
                    className={`absolute top-2 left-2 chip text-[10px] ${
                      TYPE_TONE[a.type] ?? ""
                    }`}
                  >
                    {a.type}
                  </span>
                  {a.tenantId && (
                    <span className="absolute bottom-2 right-2 chip text-[9px] bg-brand-cyan text-white border-0 font-medium">
                      My Upload
                    </span>
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <div className="font-semibold text-sm leading-tight line-clamp-2">
                    {a.title}
                  </div>
                  {a.description && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {a.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground capitalize flex items-center justify-between">
                    <span>{a.category.replace(/_/g, " ")}</span>
                    <span className="tabular-nums">{formatDate(a.createdAt)}</span>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {/* Floating Action Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-background/85 backdrop-blur-md border border-brand-cyan/30 shadow-2xl rounded-full px-5 py-3 flex items-center gap-4 animate-pop-in-centered-x">
          <div className="text-xs font-semibold text-foreground">
            Selected <span className="text-brand-cyan text-sm">{selectedIds.length}</span> assets
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds([])}
              className="p-1 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              title="Clear selection"
            >
              <X className="size-4" />
            </button>
            <button
              onClick={handleBatchDownload}
              className="rounded-full bg-brand-cyan hover:bg-brand-cyan-deep text-white px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 shadow-md hover:shadow-lg transition-all"
            >
              <Download className="size-3.5" /> Download Selected (ZIP)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
