/**
 * ToastHost — renders the global toast queue. Mount once at the app root. Each
 * toast slides up above the bottom safe-area, auto-dismisses after ~2.6s, and
 * can be tapped to dismiss early.
 */

import React, { useEffect } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useToastStore, type ToastItem, type ToastTone } from "../../lib/toast";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";
import { Text } from "./Text";

const TONE: Record<ToastTone, { bg: string; icon: string }> = {
  success: { bg: palette.success, icon: "check-circle" },
  danger: { bg: palette.danger, icon: "alert-circle" },
  info: { bg: palette.ink, icon: "info" },
};

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const insets = useSafeAreaInsets();
  if (items.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 72 }]}>
      {items.map((t) => <Row key={t.id} item={t} />)}
    </View>
  );
}

function Row({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const tone = TONE[item.tone];
  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), 2600);
    return () => clearTimeout(timer);
  }, [item.id, dismiss]);
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)}>
      <Pressable onPress={() => dismiss(item.id)} style={[styles.toast, { backgroundColor: tone.bg }]}>
        <Feather name={tone.icon as any} size={16} color={palette.white} />
        <Text style={{ color: palette.white, flex: 1, fontWeight: fontWeight.medium as any }} numberOfLines={2}>{item.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, gap: spacing.sm, alignItems: "stretch" },
  toast: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
});
