"use client";

/**
 * MFD-controlled branding template picker for SSIT library IMAGE assets.
 *
 * The MFD picks one of the named presets (Classic / Minimal / Bold / Split)
 * from the shared catalog; each maps to a server-side composite layout. A
 * height fine-tune lets them nudge the strip without leaving the preset.
 *
 * Every change re-points the preview <img> and the download link at
 * /api/content-library/[id]/branded?template=…&h=…&mode=… so the server
 * composites the requested layout. The raw S3 URL never leaves the server.
 */

import { useState } from "react";
import { Download, LayoutTemplate, Send, Crop, Users } from "lucide-react";
import { SendToClientDrawer } from "./SendToClientDrawer";
import { BulkSendDrawer } from "./BulkSendDrawer";
import {
  BRANDING_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  getBrandingTemplate,
  OUTPUT_SIZES,
  DEFAULT_SIZE_ID,
} from "@/lib/branding/templates";

export function BrandingLayoutPicker({
  assetId,
  assetTitle,
  assetType,
  assetFileUrl,
  defaultTemplateId = DEFAULT_TEMPLATE_ID,
  defaultHeightPct,
}: {
  assetId: string;
  assetTitle: string;
  assetType: string;
  assetFileUrl: string;
  defaultTemplateId?: string;
  defaultHeightPct?: number;
}) {
  const initial = getBrandingTemplate(defaultTemplateId);
  const [templateId, setTemplateId] = useState(initial.id);
  const [heightPct, setHeightPct] = useState(defaultHeightPct ?? initial.image.heightPct);
  const [sizeId, setSizeId] = useState(DEFAULT_SIZE_ID);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // Cache-buster so React swaps the <img> when params change.
  const [refreshKey, setRefreshKey] = useState(0);

  const template = getBrandingTemplate(templateId);
  const params = `template=${templateId}&h=${heightPct}&size=${sizeId}&v=${refreshKey}`;
  const previewSrc = `/api/content-library/${assetId}/branded?mode=preview&${params}`;
  const downloadHref = `/api/content-library/${assetId}/branded?mode=download&${params}`;

  function pick(id: string) {
    const t = getBrandingTemplate(id);
    setTemplateId(t.id);
    setHeightPct(t.image.heightPct); // reset the fine-tune to the preset default
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-3">
      {/* Template selector */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LayoutTemplate className="size-3.5 text-brand-cyan" />
          <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            Branding template
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {BRANDING_TEMPLATES.map((o) => {
            const active = templateId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={`text-left rounded-lg border p-2.5 text-xs transition ${
                  active
                    ? "border-brand-cyan bg-brand-cyan-light/40 ring-2 ring-brand-cyan/20"
                    : "border-border hover:bg-secondary"
                }`}
              >
                <div className="font-semibold text-[12px]">{o.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                  {o.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Height fine-tune — applies to the main strip (the small top header in
          split mode is fixed compact so it never crowds the image). */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>
            Strip height —{" "}
            <span className="tabular-nums text-foreground font-semibold">{heightPct}%</span>
            <span className="opacity-70"> of image</span>
          </span>
          <span className="text-[10px] italic">
            {template.image.position === "frame"
              ? "Header & footer band size — creative is never covered"
              : template.image.position === "split"
                ? "Bottom strip only — top header is fixed compact"
                : "Fine-tune the strip"}
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={30}
          step={1}
          value={heightPct}
          onChange={(e) => {
            setHeightPct(Number(e.target.value));
            setRefreshKey((k) => k + 1);
          }}
          className="w-full accent-brand-cyan"
        />
      </div>

      {/* Output size — multi-size export (square / portrait / story) */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Crop className="size-3.5 text-brand-cyan" />
          <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            Output size
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {OUTPUT_SIZES.map((s) => {
            const active = sizeId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSizeId(s.id);
                  setRefreshKey((k) => k + 1);
                }}
                className={`text-left rounded-lg border p-2 text-xs transition ${
                  active
                    ? "border-brand-cyan bg-brand-cyan-light/40 ring-2 ring-brand-cyan/20"
                    : "border-border hover:bg-secondary"
                }`}
              >
                <div className="font-semibold text-[12px]">{s.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-border bg-white p-2 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={previewSrc}
          src={previewSrc}
          alt="Branded preview"
          className="max-w-full h-auto rounded-md mx-auto block"
          style={{ maxHeight: "60vh" }}
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border">
        <p className="text-[11px] text-muted-foreground italic">
          Composited server-side · the raw image is never sent to the browser.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md bg-secondary hover:bg-secondary/80 border text-secondary-foreground px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
          >
            <Send className="size-3.5" /> Send to Client
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="rounded-md bg-secondary hover:bg-secondary/80 border text-secondary-foreground px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
          >
            <Users className="size-3.5" /> Send to many
          </button>
          <a href={downloadHref} className="btn-primary" download>
            <Download className="size-4" /> Download branded PNG
          </a>
        </div>
      </div>

      <SendToClientDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        assetId={assetId}
        assetTitle={assetTitle}
        assetType={assetType}
        assetFileUrl={assetFileUrl}
        brandingPosition={template.image.position}
        brandingHeightPct={heightPct}
        brandingVariant={template.image.variant ?? "solid"}
        brandingSize={sizeId}
        brandingFrameTheme={template.image.frameTheme}
      />

      <BulkSendDrawer
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        assetId={assetId}
        assetType={assetType}
      />
    </div>
  );
}
