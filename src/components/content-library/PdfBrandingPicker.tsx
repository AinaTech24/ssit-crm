"use client";

/**
 * MFD-controlled branding template picker for Equitywala library PDF assets.
 *
 * The MFD picks one of the named presets; the server prepends a branded
 * cover page (logo / firm name / ARN / title) and stamps a firm·ARN·SEBI
 * disclaimer·page-no footer band on every page, then streams the result.
 *
 * Preview + download both go through
 * /api/content-library/[id]/branded-pdf?template=…&mode=… so the raw S3 URL
 * is never exposed to the browser.
 */

import { useState } from "react";
import { Download, FileText, LayoutTemplate, Send, Users } from "lucide-react";
import { SendToClientDrawer } from "./SendToClientDrawer";
import { BulkSendDrawer } from "./BulkSendDrawer";
import { BRANDING_TEMPLATES, DEFAULT_TEMPLATE_ID, getBrandingTemplate } from "@/lib/branding/templates";

export function PdfBrandingPicker({
  assetId,
  assetTitle,
  assetType,
  assetFileUrl,
}: {
  assetId: string;
  assetTitle: string;
  assetType: string;
  assetFileUrl: string;
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const template = getBrandingTemplate(templateId);
  const params = `template=${templateId}&v=${refreshKey}`;
  const previewSrc = `/api/content-library/${assetId}/branded-pdf?mode=preview&${params}`;
  const downloadHref = `/api/content-library/${assetId}/branded-pdf?mode=download&${params}`;

  function pick(id: string) {
    setTemplateId(getBrandingTemplate(id).id);
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

      {/* Live preview — the branded cover page is page 1 of the embedded PDF. */}
      <div className="rounded-xl border border-border overflow-hidden bg-secondary/20">
        <iframe
          key={previewSrc}
          src={previewSrc}
          title="Co-branded PDF preview"
          className="w-full bg-white"
          style={{ height: "62vh" }}
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border">
        <p className="text-[11px] text-muted-foreground italic">
          Branded cover page + per-page footer · composited server-side, the raw file stays private.
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
            <Download className="size-4" /> Download co-branded PDF
          </a>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0" />
        Using the <strong className="font-semibold text-foreground">{template.label}</strong> template.
        Your logo and theme colour come from your branding settings.
      </p>

      <SendToClientDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        assetId={assetId}
        assetTitle={assetTitle}
        assetType={assetType}
        assetFileUrl={assetFileUrl}
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
