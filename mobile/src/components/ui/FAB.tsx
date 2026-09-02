/**
 * FAB — floating action button for the primary create action on a list screen.
 * Sits bottom-right above the safe area, with a spring-in entrance + press haptic.
 */

import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { palette, radius, shadow, spacing } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export function FAB({ icon = "plus", onPress }: { icon?: FeatherName; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  const { brand } = useBrand();
  return (
    <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.wrap, { bottom: insets.bottom + spacing.lg }]}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onPress();
        }}
        style={[styles.fab, { backgroundColor: brand }]}
      >
        <Feather name={icon} size={26} color={palette.white} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: spacing.lg },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: palette.brand,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.raised,
  },
});
