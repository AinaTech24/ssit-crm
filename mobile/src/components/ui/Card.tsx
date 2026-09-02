/**
 * Card — the rounded, soft-shadowed surface. `onPress` makes it a tappable card
 * with a subtle press-scale micro-interaction (native only — on web we render a
 * plain pressable so Reanimated's continuous render loop doesn't run for the
 * dozens of cards on a list, which would pin the web renderer).
 */

import React from "react";
import { View, Pressable, Platform, StyleSheet, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { palette, radius, spacing, shadow } from "../../theme/tokens";

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  padded?: boolean;
  flat?: boolean;
}

function baseStyle(padded: boolean, flat?: boolean): ViewStyle {
  return {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: padded ? spacing.lg : 0,
    borderWidth: flat ? StyleSheet.hairlineWidth : 0,
    borderColor: palette.line,
    ...(flat ? {} : shadow.card),
  };
}

const AView = Animated.createAnimatedComponent(View);

function AnimatedCard({ children, onPress, onLongPress, style, padded = true, flat }: CardProps) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const base = baseStyle(padded, flat);
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => (scale.value = withTiming(0.98, { duration: 90 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 120 }))}
    >
      <AView style={[base, animStyle, style]}>{children}</AView>
    </Pressable>
  );
}

function StaticCard({ children, onPress, onLongPress, style, padded = true, flat }: CardProps) {
  const base = baseStyle(padded, flat);
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [base, pressed && { opacity: 0.92 }, style]}>
      {children}
    </Pressable>
  );
}

export const Card = Platform.OS === "web" ? StaticCard : AnimatedCard;
