/**
 * Button — primary action primitive. Variants, loading spinner, optional icon,
 * light haptic, and a press-scale micro-interaction (native only; web renders a
 * plain pressable to avoid a perpetual Reanimated web render loop).
 */

import React from "react";
import { Pressable, ActivityIndicator, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { palette, radius, spacing, fontSize, fontWeight, TOUCH_MIN } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";
import { Text } from "./Text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm" | "lg";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  full?: boolean;
  haptic?: boolean;
  style?: ViewStyle;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: palette.brand, fg: palette.white, border: palette.brand },
  secondary: { bg: palette.surface, fg: palette.ink, border: palette.line },
  ghost: { bg: "transparent", fg: palette.brandDark, border: "transparent" },
  danger: { bg: palette.danger, fg: palette.white, border: palette.danger },
};

function useButtonBits(size: Size, variant: Variant) {
  // Buttons are the app's "accent" surface (matches the Appearance screen's
  // Primary=chrome vs Accent=highlights split) — chrome (header/tabs/avatars)
  // stays on `brand` elsewhere.
  const { accent, accentDark } = useBrand();
  const height = size === "lg" ? 54 : size === "sm" ? 38 : TOUCH_MIN;
  const v =
    variant === "primary"
      ? { bg: accent, fg: palette.white, border: accent }
      : variant === "ghost"
      ? { bg: "transparent", fg: accentDark, border: "transparent" }
      : VARIANTS[variant];
  return { height, v };
}

function Inner({ loading, icon, label, size, fg }: { loading?: boolean; icon?: React.ReactNode; label: string; size: Size; fg: string }) {
  if (loading) return <ActivityIndicator color={fg} size="small" />;
  return (
    <View style={styles.row}>
      {icon}
      <Text style={{ color: fg, fontSize: size === "sm" ? fontSize.sm : fontSize.md, fontWeight: fontWeight.semibold }}>{label}</Text>
    </View>
  );
}

const AView = Animated.createAnimatedComponent(View);

function fire(haptic: boolean | undefined, onPress?: () => void) {
  if (haptic !== false) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  onPress?.();
}

function AnimatedButton(p: ButtonProps) {
  const { variant = "primary", size = "md" } = p;
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const { height, v } = useButtonBits(size, variant);
  const isDisabled = p.disabled || p.loading;
  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => fire(p.haptic, p.onPress)}
      onPressIn={() => (scale.value = withTiming(0.97, { duration: 80 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 120 }))}
      style={p.full ? { width: "100%" } : undefined}
    >
      <AView style={[styles.base, { height, backgroundColor: v.bg, borderColor: v.border }, isDisabled && { opacity: 0.5 }, animStyle, p.style]}>
        <Inner loading={p.loading} icon={p.icon} label={p.label} size={size} fg={v.fg} />
      </AView>
    </Pressable>
  );
}

function StaticButton(p: ButtonProps) {
  const { variant = "primary", size = "md" } = p;
  const { height, v } = useButtonBits(size, variant);
  const isDisabled = p.disabled || p.loading;
  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => fire(p.haptic, p.onPress)}
      style={({ pressed }) => [styles.base, { height, backgroundColor: v.bg, borderColor: v.border }, isDisabled && { opacity: 0.5 }, pressed && { opacity: 0.9 }, p.full ? { width: "100%" } : undefined, p.style]}
    >
      <Inner loading={p.loading} icon={p.icon} label={p.label} size={size} fg={v.fg} />
    </Pressable>
  );
}

export const Button = Platform.OS === "web" ? StaticButton : AnimatedButton;

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
