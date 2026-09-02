/**
 * Segmented control — a compact toggle (e.g. List / Board, or detail tabs).
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { palette, radius, spacing } from "../../theme/tokens";
import { Text } from "./Text";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.seg, active && styles.active]}>
            <Text variant="label" style={{ color: active ? palette.ink : palette.muted }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: 3 },
  seg: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm },
  active: { backgroundColor: palette.surface, shadowColor: palette.ink, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});
