/**
 * Screen wrapper — consistent safe-area + background for every screen. Set
 * `scroll` for a scrollable body, `padded` for standard horizontal gutters.
 */

import React from "react";
import { View, ScrollView, StyleSheet, type ViewStyle, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, spacing } from "../../theme/tokens";

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Respect the bottom safe-area inset (off when a sticky bar handles it). */
  edges?: { top?: boolean; bottom?: boolean };
  background?: string;
  contentStyle?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function Screen({
  children,
  scroll,
  padded,
  edges,
  background = palette.surfaceAlt,
  contentStyle,
  refreshing,
  onRefresh,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = {
    paddingTop: edges?.top === false ? 0 : undefined,
    paddingBottom: edges?.bottom ? insets.bottom : 0,
    paddingHorizontal: padded ? spacing.lg : 0,
  };

  if (scroll) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: background }]}
        contentContainerStyle={[pad, { flexGrow: 1 }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={palette.brand} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    );
  }

  return <View style={[styles.flex, { backgroundColor: background }, pad, contentStyle]}>{children}</View>;
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
