"use client";

/**
 * In-app document preview modal. Renders images and PDFs inline (in a pop-up
 * lightbox) instead of opening a new browser tab. Used by the Documents vault
 * and the Client-360 Documents & attachments panel.
 *
 * `src` is the URL to render — either a download endpoint that 302-redirects to
 * the file (compliance vault) or an already-resolved presigned URL (client docs).
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Download, FileText } from "lucide-react";

export type ViewerDoc = {
  name: string;
  mimeType?: string | null;
  src: string;
  /** Optional download — either a direct href or a handler. */
  downloadHref?: string;
  onDownload?: () => void;
};

export function DocumentViewerModal({ doc, onClose }: { doc: ViewerDoc | null; onClose: () => void }) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  if (!doc) return null;

  const mt = (doc.mimeType || "").toLowerCase();
  const name = doc.name || "Document";
  const isImage = mt.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(name);
  const isPdf = mt === "application/pdf" || /\.pdf$/i.test(name);

  const DownloadBtn = doc.downloadHref ? (
    <a
      href={doc.downloadHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Download"
      className="size-8 grid place-items-center rounded-lg border border-border/60 text-muted-foreground hover:text-brand-cyan hover:bg-secondary/40 transition-colors"
    >
      <Download className="size-4" />
    </a>
  ) : doc.onDownload ? (
    <button
      type="button"
      onClick={doc.onDownload}
      title="Download"
      className="size-8 grid place-items-center rounded-lg border border-border/60 text-muted-foreground hover:text-brand-cyan hover:bg-secondary/40 transition-colors"
    >
      <Download className="size-4" />
    </button>
  ) : null;

  if (typeof document === "undefined") return null;

  // Portal to <body> so the fixed overlay escapes any ancestor stacking context
  // (e.g. the scrolling <main>) — otherwise the sticky topbar paints over the
  // top of the backdrop, leaving an unblurred strip.
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex flex-col w-full max-w-5xl h-[85vh] bg-card rounded-xl shadow-2xl overflow-hidden border border-border">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <FileText className="size-4 text-muted-foreground shrink-0" />
          <div className="font-semibold text-sm truncate flex-1" title={name}>
            {name}
          </div>
          {DownloadBtn}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="size-8 grid place-items-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-muted/30 flex items-center justify-center overflow-hidden p-2">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.src} alt={name} className="block max-h-full max-w-full w-auto h-auto object-contain" />
          ) : isPdf ? (
            <iframe src={doc.src} title={name} className="w-full h-full border-0" />
          ) : (
            <div className="text-center p-8 text-sm text-muted-foreground">
              <FileText className="size-10 mx-auto mb-3 opacity-40" />
              <div>Preview isn&apos;t available for this file type.</div>
              {doc.downloadHref ? (
                <a href={doc.downloadHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-brand-cyan font-medium hover:underline">
                  Download to view
                </a>
              ) : doc.onDownload ? (
                <button type="button" onClick={doc.onDownload} className="mt-3 text-brand-cyan font-medium hover:underline">
                  Download to view
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
