/**
 * Brand-logo resolver. A firm can upload several logo variants (full lockup,
 * square icon, compact monogram, favicon) — each mapped to where the software
 * uses it. `pickLogo()` resolves the best available URL for a given context,
 * with graceful fallbacks so a firm that uploaded ONLY a full logo still gets a
 * sensible render in the sidebar / favicon / etc.
 */

export type LogoVariant = "full" | "icon" | "mark" | "favicon";

/** The four columns on `tenants` that hold logo variants. */
export type LogoField = "logoUrl" | "logoIconUrl" | "logoMarkUrl" | "faviconUrl";

export type LogoFields = Partial<Record<LogoField, string | null>>;

function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Resolve a logo URL for the requested context. Fallback order is chosen so the
 * result always *looks* right for the shape the context needs:
 *   - square contexts (icon/mark/favicon) prefer square uploads, then the full
 *     logo as a last resort.
 *   - the full lockup prefers the full logo, then any square mark.
 */
export function pickLogo(t: LogoFields | null | undefined, variant: LogoVariant): string | null {
  if (!t) return null;
  const full = clean(t.logoUrl);
  const icon = clean(t.logoIconUrl);
  const mark = clean(t.logoMarkUrl);
  const fav = clean(t.faviconUrl);
  switch (variant) {
    case "full":
      return full || icon || mark || null;
    case "icon":
      return icon || mark || full || null;
    case "mark":
      return mark || icon || full || null;
    case "favicon":
      return fav || icon || mark || full || null;
    default:
      return full || null;
  }
}

/** Whether the firm has uploaded ANY logo variant at all. */
export function hasAnyLogo(t: LogoFields | null | undefined): boolean {
  return !!(t && (clean(t.logoUrl) || clean(t.logoIconUrl) || clean(t.logoMarkUrl) || clean(t.faviconUrl)));
}

/**
 * UI metadata for the firm-profile upload slots. Drives the multi-logo uploader
 * so adding/retiring a slot is a one-line change here.
 */
export const LOGO_SLOTS: Array<{
  field: LogoField;
  variant: LogoVariant;
  label: string;
  /** Recommended file specs shown under the slot. */
  hint: string;
  /** Where in the product this variant is used. */
  used: string;
  /** Preview frame shape. */
  shape: "wide" | "square";
}> = [
  {
    field: "logoUrl",
    variant: "full",
    label: "Full logo",
    hint: "Horizontal lockup · transparent PNG/SVG · ~400×120",
    used: "PDF letterheads, emails, marketing creatives, login",
    shape: "wide",
  },
  {
    field: "logoIconUrl",
    variant: "icon",
    label: "Square icon",
    hint: "Square symbol · transparent PNG · ~256×256",
    used: "Sidebar badge & small avatars",
    shape: "square",
  },
  {
    field: "logoMarkUrl",
    variant: "mark",
    label: "Monogram / half logo",
    hint: "Symbol only · transparent PNG · ~128×128",
    used: "Collapsed sidebar & watermarks",
    shape: "square",
  },
  {
    field: "faviconUrl",
    variant: "favicon",
    label: "Favicon",
    hint: "Tiny square · PNG/ICO · 32–64px",
    used: "Browser tab icon",
    shape: "square",
  },
];
