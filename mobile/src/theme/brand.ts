/**
 * Runtime brand theme. RN freezes StyleSheet values at module load, so per-tenant
 * theming can't mutate `palette` — instead this Zustand store holds the live
 * brand colours and the key interactive components (Button, FAB, Chip, tab bar,
 * headers) read from `useBrand()` so a theme change re-skins the whole app
 * instantly. Seeded from the tenant's appearance (see useApplyTenantBrand).
 */

import { create } from "zustand";
import { palette } from "./tokens";

function hexToRgb(h?: string | null): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((h ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => clamp(x).toString(16).padStart(2, "0")).join("");
function darken(hex: string, amt: number) {
  const c = hexToRgb(hex);
  return c ? toHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt)) : hex;
}
function lighten(hex: string, amt: number) {
  const c = hexToRgb(hex);
  return c ? toHex(c.r + (255 - c.r) * amt, c.g + (255 - c.g) * amt, c.b + (255 - c.b) * amt) : hex;
}

interface BrandState {
  /** Primary (chrome) — header, tab bar, avatars/logos, identity surfaces. */
  brand: string;
  brandDark: string;
  brandLight: string;
  /** Accent (highlights) — buttons, CTAs. Falls back to primary when unset,
   *  same as before this existed, so an untouched tenant sees no change. */
  accent: string;
  accentDark: string;
  accentLight: string;
  setBrand: (primaryHex?: string | null, accentHex?: string | null) => void;
}

export const useBrand = create<BrandState>((set) => ({
  brand: palette.brand,
  brandDark: palette.brandDark,
  brandLight: palette.brandLight,
  accent: palette.brand,
  accentDark: palette.brandDark,
  accentLight: palette.brandLight,
  setBrand: (primaryHex, accentHex) => {
    const p = hexToRgb(primaryHex) ? primaryHex! : palette.brand;
    const a = hexToRgb(accentHex) ? accentHex! : p;
    set({
      brand: p, brandDark: darken(p, 0.18), brandLight: lighten(p, 0.9),
      accent: a, accentDark: darken(a, 0.18), accentLight: lighten(a, 0.9),
    });
  },
}));
