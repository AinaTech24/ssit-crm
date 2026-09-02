/**
 * Shared branding-template catalog.
 *
 * A small, named set of white-labelling presets an MFD picks per download.
 * One catalog drives BOTH consumers:
 *   - image co-branding  → maps to { position, heightPct } for compose.ts
 *   - PDF co-branding     → maps to a cover-page style for compose-pdf.ts
 *   - the MFD picker UI    → renders label + description
 *
 * The logo + theme colour themselves come from the tenant's branding
 * settings (tenants.logoUrl / primaryColor) — a template only decides the
 * *layout*, never the brand identity. That keeps the identity single-sourced
 * and the template selection purely cosmetic.
 *
 * This module is intentionally dependency-free (no `sharp`, no `pdf-lib`, no
 * server-only imports) so it is safe to import from client components.
 */

// Mirror of compose.ts' BrandingPosition / BrandingVariant — declared locally
// so this module stays importable from the browser bundle (compose.ts pulls in
// `sharp`).
export type BrandingPosition = "top" | "bottom" | "both" | "split" | "frame";
export type BrandingVariant = "solid" | "light";

/** How the prepended PDF cover page is laid out. */
export type PdfCoverStyle = "banner" | "minimal" | "sidebar";

export type BrandingTemplate = {
  id: string;
  label: string;
  /** One-line description shown under the template card in the picker. */
  description: string;
  /**
   * Image co-branding knobs (consumed by compose.ts).
   *   - variant defaults to "solid" (the bold brand-colour band). "light"
   *     renders a clean white/editorial band — only meaningful for the
   *     single-strip positions (top/bottom/both); ignored for "split".
   */
  image: {
    position: BrandingPosition;
    heightPct: number;
    variant?: BrandingVariant;
    /** Visual theme for the "frame" layout. */
    frameTheme?: "premium" | "minimal" | "bold";
  };
  /** PDF cover-page style (consumed by compose-pdf.ts). */
  pdf: { coverStyle: PdfCoverStyle };
};

export const BRANDING_TEMPLATES: BrandingTemplate[] = [
  {
    id: "frame_premium",
    label: "Premium",
    description:
      "Premium social template — soft brand-tinted background, framed creative with a subtle shadow, clean header and a polished brand footer. Never covers the creative.",
    image: { position: "frame", heightPct: 13, frameTheme: "premium" },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "frame_minimal",
    label: "Minimal",
    description:
      "Soft minimal white template — airy white background, understated header, brand-coloured contact icons and a light, neat disclaimer. Clean and corporate.",
    image: { position: "frame", heightPct: 13, frameTheme: "minimal" },
    pdf: { coverStyle: "minimal" },
  },
  {
    id: "frame_bold",
    label: "Bold",
    description:
      "Bold brand template — a curved brand-coloured header section and a strong brand footer wrapping the creative. High-impact and recognisable.",
    image: { position: "frame", heightPct: 14, frameTheme: "bold" },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "classic",
    label: "Classic",
    description:
      "Full details band along the bottom edge — logo, firm name, ARN and contact. The safe default.",
    image: { position: "bottom", heightPct: 18 },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "minimal",
    label: "Minimal",
    description:
      "A slim, understated strip that keeps the creative front-and-centre.",
    image: { position: "bottom", heightPct: 11 },
    pdf: { coverStyle: "minimal" },
  },
  {
    id: "bold",
    label: "Bold",
    description:
      "Branding stamped on both the top and bottom edges for maximum recall.",
    image: { position: "both", heightPct: 16 },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "split",
    label: "Split",
    description:
      "Logo and firm name on top, contact details on the bottom — a letterhead feel.",
    image: { position: "split", heightPct: 18 },
    pdf: { coverStyle: "sidebar" },
  },
  {
    id: "editorial",
    label: "Editorial",
    description:
      "Clean white caption bar — dark text on white with a thin brand keyline. Corporate and understated.",
    image: { position: "bottom", heightPct: 14, variant: "light" },
    pdf: { coverStyle: "minimal" },
  },
  {
    id: "banner",
    label: "Banner",
    description:
      "Branding band across the top edge, the creative below — a header-first look.",
    image: { position: "top", heightPct: 14 },
    pdf: { coverStyle: "banner" },
  },
  {
    id: "memo",
    label: "Memo",
    description:
      "Slim white caption along the top — light, editorial and out of the way.",
    image: { position: "top", heightPct: 12, variant: "light" },
    pdf: { coverStyle: "minimal" },
  },
];

export const DEFAULT_TEMPLATE_ID = "classic";

/**
 * Output size presets for multi-size export. `aspect` is width/height; null
 * keeps the natural size (Frame extends the canvas, strips keep the source).
 * The creative is always fit (contain — never cropped) into the target canvas.
 */
export type OutputSize = { id: string; label: string; hint: string; aspect: number | null };

export const OUTPUT_SIZES: OutputSize[] = [
  { id: "original", label: "Original", hint: "Source size", aspect: null },
  { id: "square", label: "Square", hint: "1:1 · feed/post", aspect: 1 },
  { id: "portrait", label: "Portrait", hint: "4:5 · feed", aspect: 4 / 5 },
  { id: "story", label: "Story", hint: "9:16 · status/reel", aspect: 9 / 16 },
];

export const DEFAULT_SIZE_ID = "original";

/** Resolve a size id to its width/height aspect (null = natural). */
export function getOutputAspect(id: string | null | undefined): number | null {
  return (OUTPUT_SIZES.find((s) => s.id === id) ?? OUTPUT_SIZES[0]).aspect;
}

/** Resolve a template id to its definition, falling back to Classic. */
export function getBrandingTemplate(
  id: string | null | undefined
): BrandingTemplate {
  return (
    BRANDING_TEMPLATES.find((t) => t.id === id) ?? BRANDING_TEMPLATES[0]
  );
}

/** Type guard for a known template id. */
export function isBrandingTemplateId(id: string | null | undefined): boolean {
  return !!id && BRANDING_TEMPLATES.some((t) => t.id === id);
}
