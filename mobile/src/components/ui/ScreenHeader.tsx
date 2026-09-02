/**
 * ScreenHeader — the top bar for drawer/stack screens (which render without the
 * tab header). Back chevron + title + optional subtitle + optional right action.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, TOUCH_MIN } from "../../theme/tokens";
import { Text } from "./Text";

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={12}
        style={{ width: TOUCH_MIN, height: TOUCH_MIN, justifyContent: "center" }}
      >
        <Feather name="chevron-left" size={26} color={palette.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
});
