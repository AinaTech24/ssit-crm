/**
 * Design tokens — the single source of truth for the app's look.
 *
 * Premium business-CRM aesthetic: calm neutrals, one confident brand blue,
 * clear semantic status colors, generous spacing, soft shadows, rounded cards.
 * Every component reads from here so the system stays consistent and is trivial
 * to theme per-tenant later (tenant appearance settings can override `brand`).
 */

export const palette = {
  // Brand — matched to the "A" logo's red (per-tenant theming overrides these).
  brand: "#CF1D24",
  brandDark: "#A8141B",
  brandLight: "#FCEBEC",
  brandTint: "#F6CFD2",

  // Neutrals (slate)
  ink: "#0F172A", // primary text
  ink70: "#334155",
  muted: "#64748B", // secondary text
  faint: "#94A3B8", // tertiary / placeholders
  line: "#E2E8F0", // borders
  lineSoft: "#EEF2F6",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC", // app background
  surfaceSunken: "#F1F5F9",

  // Semantic
  success: "#16A34A",
  successBg: "#ECFDF3",
  warning: "#D97706",
  warningBg: "#FFFBEB",
  danger: "#DC2626",
  dangerBg: "#FEF2F2",
  info: "#0EA5E9",
  infoBg: "#F0F9FF",
  violet: "#7C3AED",
  violetBg: "#F5F3FF",

  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(15, 23, 42, 0.45)",
} as const;

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 17,
  lg: 19,
  xl: 23,
  "2xl": 29,
  "3xl": 35,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/** Soft, layered shadows. iOS uses shadow*, Android uses elevation. */
export const shadow = {
  none: {},
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

/** Minimum thumb-friendly touch target. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const TOUCH_MIN = 44;
