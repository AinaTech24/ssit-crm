/**
 * Tenant theming — turn a firm's two brand colours (primary + accent) into the
 * CSS-variable overrides that re-skin the whole CRM at runtime.
 *
 * The UI is entirely driven by HSL-component CSS variables declared in
 * globals.css (`--primary`, `--accent`, `--ring`, and the `--brand-navy*` /
 * `--brand-cyan*` families). To theme a tenant we simply re-declare those
 * variables on `:root` from the firm's chosen colours — every button, chip,
 * sidebar, gradient and focus ring follows automatically.
 *
 * Dependency-free + isomorphic: safe to import from the server layout AND from
 * the client-side live-preview component (no `sharp`, no server-only imports).
 *
 * Contrast safety: the "navy" family backs the dark sidebar + primary buttons
 * (white text on top), so we CLAMP its lightness dark regardless of the brand
 * colour — a firm can pick bright orange and the chrome stays legible while
 * still clearly carrying their hue. The "cyan" family backs accents/links and
 * is clamped to a mid lightness that reads on white and as a button fill.
 */

export type ThemeColors = { primary: string; accent: string };

/** The stock Equitywala palette — deep navy + electric cyan (matches globals.css). */
export const DEFAULT_THEME: ThemeColors = { primary: "#0e2557", accent: "#0ea5e9" };

/**
 * The legacy column default for `tenants.primary_color`. It was never a
 * deliberate brand choice (just the schema default), so we treat it as
 * "unbranded" and fall back to the Equitywala navy — otherwise every tenant that
 * never customised would suddenly render in flat grey.
 */
const LEGACY_DEFAULT_PRIMARY = "#1f2937";

export type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  accent: string;
};

/** Curated one-click palettes shown in the Appearance picker. */
export const THEME_PRESETS: ThemePreset[] = [
  { id: "ssit", label: "Equitywala Navy", primary: "#0e2557", accent: "#0ea5e9" },
  { id: "emerald", label: "Emerald", primary: "#064e3b", accent: "#10b981" },
  { id: "royal", label: "Royal Purple", primary: "#3b0764", accent: "#a855f7" },
  { id: "sunset", label: "Sunset Orange", primary: "#7c2d12", accent: "#f97316" },
  { id: "crimson", label: "Crimson", primary: "#4c0519", accent: "#f43f5e" },
  { id: "teal", label: "Teal", primary: "#134e4a", accent: "#14b8a6" },
  { id: "graphite", label: "Graphite", primary: "#1e293b", accent: "#475569" },
  { id: "indigo", label: "Indigo", primary: "#1e1b4b", accent: "#6366f1" },
];

/** Validate a #rrggbb string. */
export function isHexColor(s: string | null | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

/* ─────────────────── Fonts & density (migration 0164) ─────────────────── */

/** Selectable brand fonts → CSS font stacks (system/webfont-safe, no network). */
export const FONT_STACKS: Record<string, string> = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'Cascadia Code', 'Roboto Mono', Menlo, monospace",
};

export const THEME_FONTS: { id: string; label: string }[] = [
  { id: "inter", label: "Inter (default)" },
  { id: "system", label: "System UI" },
  { id: "serif", label: "Serif" },
  { id: "rounded", label: "Rounded" },
  { id: "mono", label: "Monospace" },
];

export const UI_DENSITIES: { id: string; label: string }[] = [
  { id: "comfortable", label: "Comfortable (default)" },
  { id: "compact", label: "Compact" },
];

/** Root font-size per density — everything is rem-based, so this scales text +
 *  spacing together. null when the tenant uses the default. */
function densityRootPx(uiDensity?: string | null): number | null {
  return uiDensity === "compact" ? 15 : null; // default (comfortable) = browser 16px
}

/**
 * Resolve the effective theme colours from raw tenant fields, applying the
 * "unbranded → Equitywala navy" fallback so un-customised tenants keep the polished
 * stock look.
 */
export function resolveThemeColors(
  primaryColor?: string | null,
  secondaryColor?: string | null
): ThemeColors {
  const primary =
    isHexColor(primaryColor) && primaryColor.toLowerCase() !== LEGACY_DEFAULT_PRIMARY
      ? primaryColor
      : DEFAULT_THEME.primary;
  const accent = isHexColor(secondaryColor) ? secondaryColor : DEFAULT_THEME.accent;
  return { primary, accent };
}

/* ─────────────────── Colour maths ─────────────────── */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Convert #rrggbb to HSL components (h:0-360, s/l:0-100). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return { h: 0, s: 0, l: 0 };
  const [r, g, b] = m.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Format HSL components as the `H S% L%` string CSS variables expect. */
function hslVar(h: number, s: number, l: number): string {
  return `${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%`;
}

/**
 * Build the full set of CSS-variable overrides (var name → `H S% L%`) for a
 * tenant's brand colours.
 */
export function buildThemeVars(primaryHex: string, accentHex: string): Record<string, string> {
  const p = hexToHsl(primaryHex);
  const a = hexToHsl(accentHex);

  // Navy family — dark chrome, white text. Lightness forced dark for contrast.
  const navyS = Math.max(p.s, 24);
  const navyL = clamp(p.l, 14, 30);
  const navy = hslVar(p.h, navyS, navyL);
  const navyDeep = hslVar(p.h, navyS, clamp(navyL - 7, 8, 24));
  const navyLight = hslVar(p.h, clamp(p.s, 18, 64), 95);

  // Interactive family — links, active states, focus, accent buttons.
  // ONE accent per tenant: derived from the PRIMARY hue (a brighter cut of it),
  // so buttons, links, rings and the active-nav pill all agree. The secondary
  // "accent" colour only tints decorative surfaces (--accent) — it no longer
  // introduces a second interactive hue.
  const accS = Math.max(p.s, 45);
  const accL = clamp(p.l, 38, 54);
  const cyan = hslVar(p.h, accS, accL);
  const cyanDeep = hslVar(p.h, accS, clamp(accL - 11, 26, 46));
  const cyanLight = hslVar(p.h, clamp(p.s, 30, 92), 95);
  // --accent is a HOVER SURFACE (light tint) with dark text of the same hue.
  const decorative = hslVar(a.h, clamp(a.s, 30, 92), 95);
  const decorativeFg = hslVar(a.h, Math.max(a.s, 40), 30);

  return {
    "--primary": navy,
    "--ring": cyan,
    "--accent": decorative,
    "--accent-foreground": decorativeFg,
    "--brand-navy": navy,
    "--brand-navy-deep": navyDeep,
    "--brand-navy-light": navyLight,
    "--brand-cyan": cyan,
    "--brand-cyan-deep": cyanDeep,
    "--brand-cyan-light": cyanLight,
    // Active-nav pill follows the tenant brand (was pinned to product red,
    // which made branded tenants render a red pill next to brand-hue buttons).
    "--nav-active-bg": navy,
    "--nav-active-fg": "0 0% 100%",
  };
}

/**
 * Build a `:root { … }` CSS string from a tenant's brand colours, for injection
 * into a `<style>` tag in the dashboard layout. Returns `""` when the colours
 * are the stock Equitywala palette (nothing to override).
 */
/**
 * Optional per-tenant overrides for body TEXT colour and the HOVER / secondary
 * surface colour. Text maps to --foreground (exact hue); hover maps to
 * --secondary as a light brand tint (it's a background surface, so we force a
 * high lightness for legibility). Returns only the vars that are set + valid.
 */
function extraThemeVars(textColor?: string | null, hoverColor?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (isHexColor(textColor)) {
    const t = hexToHsl(textColor);
    const v = hslVar(t.h, t.s, t.l);
    out["--foreground"] = v;
    out["--card-foreground"] = v;
  }
  if (isHexColor(hoverColor)) {
    const h = hexToHsl(hoverColor);
    out["--secondary"] = hslVar(h.h, clamp(h.s, 12, 80), 94);
  }
  return out;
}

export function buildTenantThemeCss(
  primaryColor?: string | null,
  secondaryColor?: string | null,
  textColor?: string | null,
  hoverColor?: string | null,
  fontFamily?: string | null,
  uiDensity?: string | null
): string {
  const { primary, accent } = resolveThemeColors(primaryColor, secondaryColor);
  const vars: Record<string, string> = {};
  // Brand colours only when actually customised (stock palette → nothing).
  if (!(primary === DEFAULT_THEME.primary && accent === DEFAULT_THEME.accent)) {
    Object.assign(vars, buildThemeVars(primary, accent));
  }
  // Text + hover apply independently of the brand colours.
  Object.assign(vars, extraThemeVars(textColor, hoverColor));

  const out: string[] = [];
  const keys = Object.keys(vars);
  if (keys.length) {
    // Colours scope to light mode only — the `.dark` palette wins in dark mode.
    out.push(`:root:not(.dark){ ${keys.map((k) => `${k}: ${vars[k]};`).join(" ")} }`);
  }
  // Font + density apply in BOTH modes.
  const stack = fontFamily && fontFamily !== "inter" ? FONT_STACKS[fontFamily] : null;
  if (stack) out.push(`:root{ --brand-font: ${stack}; }`);
  const px = densityRootPx(uiDensity);
  if (px) out.push(`html{ font-size: ${px}px; }`);
  return out.join(" ");
}

/**
 * Same vars as an inline-style object — used by the client live-preview to
 * scope the theme to a single container without touching `:root`.
 */
export function buildThemeStyleObject(
  primaryHex: string,
  accentHex: string,
  textColor?: string | null,
  hoverColor?: string | null
): Record<string, string> {
  return { ...buildThemeVars(primaryHex, accentHex), ...extraThemeVars(textColor, hoverColor) };
}
