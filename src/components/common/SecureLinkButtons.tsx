"use client";

/**
 * Drop-in replacements for `<a href="/api/…">` links that would otherwise leak
 * the server route in the browser status bar (hover) or a new tab's address
 * bar. These render a real <button> and perform the action via JS, so the API
 * route is never shown in the UI chrome.
 *
 * Being client components, they can be rendered from server components too
 * (where onClick handlers aren't allowed) — just swap the tag:
 *
 *   <a href={`/api/x/export`} className="btn">Export</a>
 *     → <DownloadButton url={`/api/x/export`} className="btn">Export</DownloadButton>
 *
 *   <a href={pdfUrl} target="_blank" className="btn">Open</a>
 *     → <OpenDocButton url={pdfUrl} className="btn">Open</OpenDocButton>
 *
 *   <a href={`/api/oauth/start`} className="btn">Connect</a>   (server redirect)
 *     → <NavButton url={`/api/oauth/start`} className="btn">Connect</NavButton>
 */

import type { ReactNode } from "react";
import { downloadFile, openInNewTab, goTo } from "@/lib/secure-download";

type Props = {
  url: string;
  /** Optional filename hint for downloads (server Content-Disposition wins). */
  filename?: string;
  className?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  children: ReactNode;
};

/** Download a file from a server route without exposing the route. */
export function DownloadButton({ url, filename, className, title, ariaLabel, disabled, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => downloadFile(url, filename)}
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Open a document (PDF) in a new tab as a blob: URL — route hidden everywhere. */
export function OpenDocButton({ url, className, title, ariaLabel, disabled, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => openInNewTab(url)}
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Navigate the current tab to a server route (OAuth start / redirects). */
export function NavButton({ url, className, title, ariaLabel, disabled, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => goTo(url)}
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
