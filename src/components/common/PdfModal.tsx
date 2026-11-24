"use client";

/**
 * Shared document preview modal — renders a PDF (or a same-origin print page)
 * in an <iframe> inside a popup, with zoom (the page is re-fitted to a wider or narrower frame) and a download/print
 * action. The browser's built-in PDF chrome is hidden via the
 * #toolbar=0&navpanes=0&scrollbar=0 fragment, and the modal's own scrollbars
 * are hidden, so only the document shows.
 *
 *   <PdfModal title="…" pdfUrl="/api/proposals/ID/pdf"
 *             downloadUrl="/api/proposals/ID/pdf?download=1" onClose={…} />
 *
 * When no `downloadUrl` is given (e.g. an HTML print page that isn't a real
 * PDF file) the action prints the iframe instead, so the user can save to PDF.
 */

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, ZoomIn, ZoomOut, ExternalLink, Printer, Loader2 } from "lucide-react";
import { downloadFile, openInNewTab } from "@/lib/secure-download";

export function PdfModal({
  title,
  pdfUrl,
  downloadUrl,
  onClose,
}: {
  title: string;
  pdfUrl: string;
  downloadUrl?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dec = () => setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(2)));
  const inc = () => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)));

  const src = pdfUrl.includes("#") ? pdfUrl : `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;

  function printIframe() {
    try { iframeRef.current?.contentWindow?.focus(); iframeRef.current?.contentWindow?.print(); } catch { /* cross-origin */ }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b bg-secondary/40">
          <div className="font-semibold text-sm truncate">{title}</div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex items-center rounded-md border bg-card">
              <button onClick={dec} className="p-1.5 hover:bg-accent rounded-l-md" aria-label="Zoom out" title="Zoom out"><ZoomOut className="size-3.5" /></button>
              <button onClick={() => setZoom(1)} className="px-2 py-1 text-[11px] tabular-nums hover:bg-accent w-12 text-center" title="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button onClick={inc} className="p-1.5 hover:bg-accent rounded-r-md" aria-label="Zoom in" title="Zoom in"><ZoomIn className="size-3.5" /></button>
            </div>
            {downloadUrl ? (
              <button onClick={() => downloadFile(downloadUrl)} className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1" title="Download"><Download className="size-3" /> Download</button>
            ) : (
              <button onClick={printIframe} className="btn-secondary text-xs px-2.5 py-1 inline-flex items-center gap-1" title="Print / Save as PDF"><Printer className="size-3" /> Print</button>
            )}
            <button onClick={() => openInNewTab(pdfUrl)} className="p-1.5 rounded hover:bg-accent" aria-label="Open in new tab" title="Open in new tab"><ExternalLink className="size-4" /></button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent" aria-label="Close"><X className="size-4" /></button>
          </div>
        </div>
        <div className="relative flex-1 overflow-auto scrollbar-none bg-neutral-200/50 dark:bg-neutral-900/50">
          {/* Loading state — the PDF is generated server-side, so show feedback
              until the iframe fires onLoad instead of a blank/janky pane. */}
          {!loaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-brand-cyan" />
              <span className="text-xs">Preparing document…</span>
            </div>
          )}
          {/* Zoom works by resizing the frame, not by scaling it: the PDF viewer is told to fit
              the page to its width (view=FitH), so a frame at 70% width shows the page at 70%,
              centred, and a frame at 140% shows it larger (the pane then scrolls sideways).
              Scaling the iframe with CSS instead left the page small in a big empty box, with
              the bottom of the page cut off.
              The iframe itself is ~18px wider/taller than its clip so the PDF viewer's own
              scrollbars (which #scrollbar=0 no longer hides in modern Chrome/PDFium) fall
              outside the clip and are hidden - only the scrollbar is cut off, never content. */}
          <div
            className="mx-auto overflow-hidden"
            style={{ width: `${Math.round(zoom * 100)}%`, height: "100%", transition: "width 0.2s ease" }}
          >
            <iframe
              ref={iframeRef}
              src={src}
              title={title}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              className={`border-0 bg-white block scrollbar-none transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
              style={{ width: "calc(100% + 18px)", height: "calc(100% + 18px)" }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
