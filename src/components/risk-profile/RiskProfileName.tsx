"use client";

/**
 * Risk Profiles list helpers:
 *   - <RiskProfileName>      — the investor-name cell. Clicking opens the Risk
 *                              Profile PDF in a popup modal WHEN a profile
 *                              exists; when not yet profiled the name is plain
 *                              text (clicking does nothing).
 *   - <RiskProfilePdfButtons> — View + Download buttons for a completed profile.
 *
 * Both share the PdfModal (the /api/risk-profiles/[id]/pdf route serves the PDF
 * inline so it renders in an <iframe>).
 */
import { useState } from "react";
import { X, Download, Eye, ZoomIn, ZoomOut } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";

function PdfModal({ profileId, name, onClose }: { profileId: string; name: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const dec = () => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)));
  const inc = () => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)));

  // #toolbar=0&navpanes=0&scrollbar=0 hides the browser's built-in PDF chrome so
  // only the document shows; zoom is our own smooth CSS transform.
  const src = `/api/risk-profiles/${profileId}/pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b bg-secondary/40">
          <div className="font-semibold text-sm truncate">Risk Profile · {name}</div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center rounded-md border bg-card">
              <button onClick={dec} className="p-1.5 hover:bg-accent rounded-l-md" aria-label="Zoom out" title="Zoom out">
                <ZoomOut className="size-3.5" />
              </button>
              <button
                onClick={() => setZoom(1)}
                className="px-2 py-1 text-[11px] tabular-nums hover:bg-accent w-12 text-center"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button onClick={inc} className="p-1.5 hover:bg-accent rounded-r-md" aria-label="Zoom in" title="Zoom in">
                <ZoomIn className="size-3.5" />
              </button>
            </div>
            <DownloadButton
              url={`/api/risk-profiles/${profileId}/pdf?download=1`}
              className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1"
              title="Download"
            >
              <Download className="size-3" /> Download
            </DownloadButton>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-neutral-200/50">
          <iframe
            src={src}
            title={`Risk Profile PDF — ${name}`}
            className="border-0 bg-white block mx-auto"
            style={{
              width: "100%",
              height: "100%",
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              transition: "transform 0.2s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function RiskProfileName({
  name,
  pan,
  profileId,
}: {
  name: string;
  pan: string | null;
  profileId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {profileId ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium hover:underline text-left"
          title="View Risk Profile PDF"
        >
          {name}
        </button>
      ) : (
        // Not yet profiled — nothing to open, so the name is plain text.
        <span className="font-medium text-foreground">{name}</span>
      )}
      {pan && <div className="text-xs text-muted-foreground font-mono">{pan}</div>}
      {open && profileId && <PdfModal profileId={profileId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RiskProfilePdfButtons({ profileId, name }: { profileId: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  if (!profileId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-xs p-1.5 inline-flex items-center"
        title="View Risk Profile PDF"
        aria-label="View Risk Profile PDF"
      >
        <Eye className="size-3.5" />
      </button>
      <DownloadButton
        url={`/api/risk-profiles/${profileId}/pdf?download=1`}
        className="btn-secondary text-xs p-1.5 inline-flex items-center"
        title="Download Risk Profile PDF"
        ariaLabel="Download Risk Profile PDF"
      >
        <Download className="size-3.5" />
      </DownloadButton>
      {open && <PdfModal profileId={profileId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
