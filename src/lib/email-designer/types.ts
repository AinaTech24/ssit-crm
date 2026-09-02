/**
 * Email Designer — block schemas + theme + body envelope.
 *
 * The template body for `channel='email'` now stores either:
 *   mode: 'designer'  → { theme, blocks, footer }
 *   mode: 'html'      → { html }
 *
 * Both modes share `subject`, `preheader`, `textFallback`. The server renderer
 * (`render.ts`) compiles either to inline-styled, email-client-safe HTML.
 *
 * Merge fields use mustache syntax: `{{investor.name}}`, `{{tenant.arn}}`, etc.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Theme — brand + typography + container
// ---------------------------------------------------------------------------

export const EmailThemeSchema = z.object({
  /** Logo URL — usually pulled from tenant brandingConfig.logoUrl. */
  logoUrl: z.string().optional(),
  logoHeight: z.number().int().min(20).max(120).default(40),
  logoAlign: z.enum(["left", "center", "right"]).default("center"),

  /** Brand color (primary). Used by buttons, links, accent strips. */
  brandColor: z.string().default("#0ea5e9"),
  /** Accent / heading color (usually darker). */
  accentColor: z.string().default("#0e2557"),
  /** Outer page bg (around the email card). */
  pageBackground: z.string().default("#f5f7fb"),
  /** Email card bg. */
  cardBackground: z.string().default("#ffffff"),
  /** Body text color. */
  textColor: z.string().default("#111827"),
  /** Muted text color. */
  mutedColor: z.string().default("#6b7280"),

  fontFamily: z
    .enum(["sans", "serif", "modern", "rounded"])
    .default("sans"),
  baseFontSize: z.number().int().min(12).max(20).default(15),

  /** Card width in px. */
  containerWidth: z.number().int().min(480).max(800).default(600),
  /** Rounded corners on the email card. */
  cornerRadius: z.number().int().min(0).max(24).default(12),
});

export type EmailTheme = z.infer<typeof EmailThemeSchema>;

// ---------------------------------------------------------------------------
// Block types — each is a typed editor + renderer pair
// ---------------------------------------------------------------------------

export const BLOCK_TYPES = [
  "logo",
  "hero",
  "heading",
  "text",
  "button",
  "image",
  "image_row",
  "data_table",
  "divider",
  "spacer",
  "quote",
  "social",
  "html",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const baseBlock = { id: z.string(), type: z.string() };

export const LogoBlock = z.object({ ...baseBlock, type: z.literal("logo") });
export const HeroBlock = z.object({
  ...baseBlock,
  type: z.literal("hero"),
  title: z.string().default("Welcome, {{investor.name}}"),
  subtitle: z.string().default(""),
  imageUrl: z.string().default(""),
  imageAlt: z.string().default(""),
  align: z.enum(["left", "center"]).default("center"),
});
export const HeadingBlock = z.object({
  ...baseBlock,
  type: z.literal("heading"),
  text: z.string().default("Section heading"),
  level: z.enum(["h1", "h2", "h3"]).default("h2"),
  align: z.enum(["left", "center", "right"]).default("left"),
});
export const TextBlock = z.object({
  ...baseBlock,
  type: z.literal("text"),
  /** Stored as light HTML (allows <b>, <i>, <a>, <br>). */
  html: z.string().default("Type your message here. Use the merge field picker to insert variables."),
  align: z.enum(["left", "center", "right"]).default("left"),
});
export const ButtonBlock = z.object({
  ...baseBlock,
  type: z.literal("button"),
  label: z.string().default("View dashboard"),
  url: z.string().default("https://"),
  align: z.enum(["left", "center", "right"]).default("center"),
  style: z.enum(["solid", "outline"]).default("solid"),
  fullWidth: z.boolean().default(false),
});
export const ImageBlock = z.object({
  ...baseBlock,
  type: z.literal("image"),
  url: z.string().default(""),
  alt: z.string().default(""),
  width: z.number().int().min(50).max(800).default(560),
  align: z.enum(["left", "center", "right"]).default("center"),
  linkUrl: z.string().optional(),
});
export const ImageRowBlock = z.object({
  ...baseBlock,
  type: z.literal("image_row"),
  items: z.array(z.object({ url: z.string(), alt: z.string().default(""), linkUrl: z.string().optional() })).min(2).max(3).default([
    { url: "", alt: "" },
    { url: "", alt: "" },
  ]),
});
export const DataTableBlock = z.object({
  ...baseBlock,
  type: z.literal("data_table"),
  caption: z.string().default(""),
  rows: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([
      { label: "Scheme", value: "{{transaction.scheme_name}}" },
      { label: "Amount", value: "₹{{transaction.amount}}" },
      { label: "Date", value: "{{transaction.transaction_date}}" },
    ]),
});
export const DividerBlock = z.object({
  ...baseBlock,
  type: z.literal("divider"),
  thickness: z.number().int().min(1).max(6).default(1),
  color: z.string().default("#e5e7eb"),
});
export const SpacerBlock = z.object({
  ...baseBlock,
  type: z.literal("spacer"),
  height: z.number().int().min(4).max(120).default(24),
});
export const QuoteBlock = z.object({
  ...baseBlock,
  type: z.literal("quote"),
  text: z.string().default("A great client relationship is built on trust."),
  author: z.string().default(""),
});
export const SocialBlock = z.object({
  ...baseBlock,
  type: z.literal("social"),
  links: z
    .object({
      website: z.string().default(""),
      linkedin: z.string().default(""),
      facebook: z.string().default(""),
      instagram: z.string().default(""),
      youtube: z.string().default(""),
      twitter: z.string().default(""),
    })
    .default({ website: "", linkedin: "", facebook: "", instagram: "", youtube: "", twitter: "" }),
});
export const HtmlBlock = z.object({
  ...baseBlock,
  type: z.literal("html"),
  html: z.string().default("<!-- Custom HTML — merge fields supported -->"),
});

export const BlockSchema = z.discriminatedUnion("type", [
  LogoBlock,
  HeroBlock,
  HeadingBlock,
  TextBlock,
  ButtonBlock,
  ImageBlock,
  ImageRowBlock,
  DataTableBlock,
  DividerBlock,
  SpacerBlock,
  QuoteBlock,
  SocialBlock,
  HtmlBlock,
]);

export type EmailBlock = z.infer<typeof BlockSchema>;

// ---------------------------------------------------------------------------
// Footer config (auto-includes ARN, etc.)
// ---------------------------------------------------------------------------

export const EmailFooterSchema = z.object({
  includeArn: z.boolean().default(true),
  includeAddress: z.boolean().default(true),
  includeUnsubscribe: z.boolean().default(true),
  customText: z.string().optional(),
});

export type EmailFooter = z.infer<typeof EmailFooterSchema>;

// ---------------------------------------------------------------------------
// Designer body — what gets stored in `template_versions.body` for emails
// ---------------------------------------------------------------------------

export const EmailDesignerBodySchema = z.object({
  /** Required across both modes. */
  subject: z.string().default(""),
  preheader: z.string().default("").optional(),

  /** "designer" — block UI; "html" — raw paste. */
  mode: z.enum(["designer", "html"]).default("designer"),

  /** When mode === "designer". */
  theme: EmailThemeSchema.optional(),
  blocks: z.array(BlockSchema).default([]),
  footer: EmailFooterSchema.default({}),

  /** When mode === "html". */
  html: z.string().optional(),

  /** Plain-text fallback for clients that can't render HTML. Auto-generated
   *  if blank when saving. */
  textFallback: z.string().optional(),
});

export type EmailDesignerBody = z.infer<typeof EmailDesignerBodySchema>;
