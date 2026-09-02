"use client";

/**
 * Route-hiding file helpers.
 *
 * Putting a server URL in an `<a href="/api/…">` leaks that route in the
 * browser's status bar on hover (and, for `target="_blank"`, in the new tab's
 * address bar). These helpers do the same actions — download, open, navigate —
 * WITHOUT ever placing the route in a hoverable/visible anchor, so internal API
 * routes are never revealed in the UI chrome.
 *
 *   import { downloadFile, openInNewTab, goTo } from "@/lib/secure-download";
 *   <button onClick={() => downloadFile(`/api/…/pdf?download=1`)}>Download</button>
 *
 * Same-origin fetches include the auth cookie automatically. If a fetch fails
 * (network / popup blocked) we fall back to a transient hidden anchor that is
 * created, clicked and removed synchronously — so it's never hovered either.
 */

function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  // RFC 5987 (filename*=UTF-8''…) first, then plain filename="…".
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, "").trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1]?.trim() ?? null;
}

/** Best-effort filename from the URL path when the server didn't send one. */
function inferName(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const last = path.split("/").filter(Boolean).pop() || "download";
    return /\.[a-z0-9]{1,5}$/i.test(last) ? last : `${last}.pdf`;
  } catch {
    return "download";
  }
}

function saveBlob(blob: Blob, name: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

/** Transient, never-hovered anchor — used only as a fallback when fetch fails. */
function hiddenNav(url: string, download: boolean): void {
  const a = document.createElement("a");
  a.href = url;
  if (download) a.download = "";
  else {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download a file from a server route without exposing the route. Fetches the
 * URL, then saves the blob with the server-provided filename (Content-
 * Disposition) or a sensible fallback.
 */
export async function downloadFile(url: string, fallbackName?: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = filenameFromDisposition(res.headers.get("content-disposition")) || fallbackName || inferName(url);
    saveBlob(blob, name);
  } catch {
    hiddenNav(url, true);
  }
}

/**
 * Open a document (e.g. a PDF) in a new tab as a `blob:` URL, so the API route
 * appears in neither the status bar nor the new tab's address bar.
 */
export async function openInNewTab(url: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    if (!w) saveBlob(blob, inferName(url)); // popup blocked → save instead of losing the action
  } catch {
    hiddenNav(url, false);
  }
}

/**
 * Navigate the current tab to a server route (OAuth start, server redirects)
 * without a hoverable `<a href>`. Use for endpoints that 3xx-redirect.
 */
export function goTo(url: string): void {
  window.location.assign(url);
}
