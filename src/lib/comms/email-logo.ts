/**
 * Shared logo header for free-form / transactional emails (business-entry
 * confirmations, free Compose, …) so every outbound email leads with the firm's
 * logo — matching what the template designer already does via its logo block.
 *
 * When the firm has no logo uploaded this falls back to its NAME rather than
 * returning nothing, so a transactional email never opens with a blank header.
 * Returns "" only when there is neither a logo nor a name.
 *
 * The fallback is the firm's own name, never the product logo — the whiteLabel
 * flag exists to keep Equitywala branding off client-facing mail.
 */

/** Email clients (Gmail/Outlook) can't load a relative path — make the logo URL
 *  absolute against the app's public URL. No-ops for already-absolute URLs. */
export function absoluteEmailUrl(url?: string | null): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

export function emailLogoHeaderHtml(
  logoUrl?: string | null,
  firmName?: string | null,
  brandColor?: string | null
): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const url = absoluteEmailUrl(logoUrl);
  const name = String(firmName ?? "").trim();

  if (url) {
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<div style="text-align:center;margin:0 0 18px;"><img src="${safeUrl}" alt="${esc(name || "Logo")}" height="40" style="height:40px;max-height:48px;display:inline-block;border:0;outline:none;"/></div>`;
  }
  if (!name) return "";
  const color = esc(String(brandColor || "#841f21"));
  return `<div style="text-align:center;margin:0 0 18px;"><span style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.3px;color:${color};line-height:1.2;">${esc(name)}</span></div>`;
}
