/**
 * Typed text primitive. Variants encode the type scale so screens never
 * hard-code font sizes/weights. `tone` picks a semantic color.
 */

import React from "react";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { fontSize, fontWeight, palette } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";

type Variant = "display" | "title" | "heading" | "subtitle" | "body" | "label" | "caption";
type ColorTone = "default" | "muted" | "faint" | "brand" | "success" | "warning" | "danger" | "inverse";

const VARIANT: Record<Variant, TextStyle> = {
  display: { fontSize: fontSize["3xl"], fontWeight: fontWeight.bold, color: palette.ink, letterSpacing: -0.5 },
  title: { fontSize: fontSize["2xl"], fontWeight: fontWeight.bold, color: palette.ink, letterSpacing: -0.3 },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: palette.ink },
  subtitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: palette.ink },
  body: { fontSize: fontSize.base, fontWeight: fontWeight.regular, color: palette.ink70 },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: palette.ink70 },
  caption: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: palette.muted },
};

const COLOR: Record<ColorTone, string> = {
  default: palette.ink,
  muted: palette.muted,
  faint: palette.faint,
  brand: palette.brandDark,
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  inverse: palette.white,
};

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: ColorTone;
  weight?: keyof typeof fontWeight;
  center?: boolean;
}

export function Text({ variant = "body", tone, weight, center, style, ...rest }: TextProps) {
  const { brandDark } = useBrand();
  return (
    <RNText
      style={[
        VARIANT[variant],
        tone ? { color: tone === "brand" ? brandDark : COLOR[tone] } : null,
        weight ? { fontWeight: fontWeight[weight] } : null,
        center ? { textAlign: "center" } : null,
        style,
      ]}
      {...rest}
    />
  );
}
