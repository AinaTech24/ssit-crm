/**
 * Theme entry. For now a single light theme exposed as a constant + a `useTheme`
 * hook so components don't import tokens directly (makes per-tenant theming and
 * a future dark mode a one-file change).
 */

import { palette, spacing, radius, fontSize, fontWeight, shadow } from "./tokens";

export const theme = {
  color: palette,
  spacing,
  radius,
  fontSize,
  fontWeight,
  shadow,
} as const;

export type Theme = typeof theme;

/** Hook form (stable identity) — keeps call-sites future-proof for context theming. */
export function useTheme(): Theme {
  return theme;
}

export * from "./tokens";

/**
 * Tone → semantic color pair (text + background) for status pills / badges.
 * Entity status enums map to a tone via src/lib/status.ts.
 */
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

export function toneColors(tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "brand":
      return { fg: palette.brandDark, bg: palette.brandLight };
    case "success":
      return { fg: palette.success, bg: palette.successBg };
    case "warning":
      return { fg: palette.warning, bg: palette.warningBg };
    case "danger":
      return { fg: palette.danger, bg: palette.dangerBg };
    case "info":
      return { fg: palette.info, bg: palette.infoBg };
    case "violet":
      return { fg: palette.violet, bg: palette.violetBg };
    default:
      return { fg: palette.muted, bg: palette.surfaceSunken };
  }
}
