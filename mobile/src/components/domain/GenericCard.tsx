/**
 * GenericCard — a configurable list row for the many modules that share the same
 * shape: leading icon, title + subtitle, a status badge, and an optional
 * right-aligned value. Modules map their fields to these props.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";
import type { Tone } from "../../theme";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export function GenericCard({
  icon,
  iconTone = "brand",
  title,
  subtitle,
  badge,
  badge2,
  rightLabel,
  rightValue,
  onPress,
}: {
  icon: FeatherName;
  iconTone?: "brand" | "violet" | "success" | "warning" | "danger" | "info";
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: Tone };
  badge2?: { label: string; tone: Tone };
  rightLabel?: string;
  rightValue?: string;
  onPress: () => void;
}) {
  const { brandDark, brandLight } = useBrand();
  const iconBg: Record<string, string> = {
    brand: brandLight,
    violet: palette.violetBg,
    success: palette.successBg,
    warning: palette.warningBg,
    danger: palette.dangerBg,
    info: palette.infoBg,
  };
  const iconFg: Record<string, string> = {
    brand: brandDark,
    violet: palette.violet,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
  };

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={[styles.icon, { backgroundColor: iconBg[iconTone] }]}>
          <Feather name={icon} size={18} color={iconFg[iconTone]} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {badge || badge2 ? (
            <View style={styles.badges}>
              {badge ? <StatusPill label={badge.label} tone={badge.tone} size="sm" /> : null}
              {badge2 ? <StatusPill label={badge2.label} tone={badge2.tone} size="sm" dot={false} /> : null}
            </View>
          ) : null}
        </View>
        {rightValue ? (
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            {rightLabel ? (
              <Text variant="caption" tone="faint">
                {rightLabel}
              </Text>
            ) : null}
            <Text variant="subtitle">{rightValue}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  icon: { width: 46, height: 46, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2 },
});
