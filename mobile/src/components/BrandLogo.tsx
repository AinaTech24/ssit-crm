/**
 * BrandLogo — the firm's "A" mark (assets/android-icon-foreground.png), optionally
 * with the "SSIT CRM" wordmark. Used on the boot/loading screen and login so
 * branding is consistent everywhere.
 */

import React from "react";
import { View, Image, StyleSheet, type ViewStyle } from "react-native";
import { Text } from "./ui/Text";
import { spacing, fontWeight, palette } from "../theme/tokens";

const LOGO = require("../../assets/android-icon-foreground.png");

export function BrandLogo({
  size = 44,
  showWordmark = false,
  wordmarkColor = palette.ink,
  style,
}: {
  size?: number;
  showWordmark?: boolean;
  wordmarkColor?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.row, style]}>
      <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" />
      {showWordmark ? (
        <Text style={{ fontSize: size * 0.42, fontWeight: fontWeight.bold as any, color: wordmarkColor, letterSpacing: -0.4 }}>
          SSIT CRM
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
