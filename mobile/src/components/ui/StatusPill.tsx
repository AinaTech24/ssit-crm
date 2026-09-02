/**
 * StatusPill — the color-coded status badge used across every entity. Pass a
 * label + tone; src/lib/status.ts maps entity status enums → (label, tone).
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { toneColors, type Tone } from "../../theme";
import { Text } from "./Text";

interface StatusPillProps {
  label: string;
  tone?: Tone;
  dot?: boolean;
  size?: "sm" | "md";
}

export function StatusPill({ label, tone = "neutral", dot = true, size = "md" }: StatusPillProps) {
  const { fg, bg } = toneColors(tone);
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: bg, paddingVertical: size === "sm" ? 2 : 4, paddingHorizontal: size === "sm" ? 8 : 10 },
      ]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: fg }]} />}
      <Text style={{ color: fg, fontSize: size === "sm" ? fontSize.xs : fontSize.sm, fontWeight: fontWeight.semibold }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
