/**
 * Skeleton — shimmering placeholder block. Compose them into list-row / card
 * skeletons for loading states (better perceived performance than a spinner).
 */

import React, { useEffect } from "react";
import { View, Platform, type ViewStyle, type DimensionValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { palette, radius, spacing } from "../../theme/tokens";

export function Skeleton({
  width = "100%",
  height = 14,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: ViewStyle;
}) {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    // Web: keep it static (a never-ending Reanimated loop pins the render loop
    // and makes headless screenshots hang). Native: gentle shimmer.
    if (Platform.OS === "web") {
      opacity.value = 0.7;
      return;
    }
    opacity.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: rounded, backgroundColor: palette.surfaceSunken }, anim, style]}
    />
  );
}

/** A skeleton shaped like a typical list row (avatar + two lines). */
export function SkeletonRow() {
  return (
    <View style={{ flexDirection: "row", gap: spacing.md, padding: spacing.lg }}>
      <Skeleton width={44} height={44} rounded={radius.pill} />
      <View style={{ flex: 1, gap: spacing.sm, justifyContent: "center" }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}
