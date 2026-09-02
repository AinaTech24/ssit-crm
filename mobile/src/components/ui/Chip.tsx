/**
 * Chip — selectable filter chip. Rows of these replace web filter dropdowns for
 * quick toggles; the full filter set lives in a bottom sheet.
 */

import React from "react";
import { Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";
import { Text } from "./Text";

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  count?: number;
}

export function Chip({ label, selected, onPress, count }: ChipProps) {
  const { brand } = useBrand();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={[styles.chip, selected ? [styles.selected, { backgroundColor: brand, borderColor: brand }] : styles.unselected]}
    >
      <Text
        style={{
          color: selected ? palette.white : palette.ink70,
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
        }}
      >
        {label}
        {count != null ? ` ${count}` : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  selected: { backgroundColor: palette.brand, borderColor: palette.brand },
  unselected: { backgroundColor: palette.surface, borderColor: palette.line },
});
