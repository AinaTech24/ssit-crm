/**
 * DetailScaffold — the generic detail screen: header, an optional hero (big
 * value + badges), a fields table, and free-text sections. Modules pass resolved
 * data; loading/error are handled here.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "./ui/ScreenHeader";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { StatusPill } from "./ui/StatusPill";
import { LoadingState, ErrorState } from "./states";
import { palette, spacing } from "../theme/tokens";
import type { Tone } from "../theme";

export interface DetailBadge {
  label: string;
  tone: Tone;
  dot?: boolean;
}
export interface DetailField {
  label: string;
  value?: string | null;
}
export interface DetailSection {
  title: string;
  body?: string | null;
}

export function DetailScaffold({
  title,
  subtitle,
  loading,
  isError,
  errorMessage,
  onRetry,
  heroLabel,
  heroValue,
  badges,
  fields,
  sections,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  heroLabel?: string;
  heroValue?: string;
  badges?: DetailBadge[];
  fields?: DetailField[];
  sections?: DetailSection[];
  children?: React.ReactNode;
}) {
  if (loading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title={title} />
        <LoadingState />
      </View>
    );
  if (isError)
    return (
      <View style={styles.screen}>
        <ScreenHeader title={title} />
        <ErrorState message={errorMessage} onRetry={onRetry} />
      </View>
    );

  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} subtitle={subtitle} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          {heroValue || badges?.length ? (
            <Card>
              {heroLabel ? (
                <Text variant="caption" tone="faint">
                  {heroLabel}
                </Text>
              ) : null}
              {heroValue ? (
                <Text variant="title" tone="brand">
                  {heroValue}
                </Text>
              ) : null}
              {badges?.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: heroValue ? spacing.md : 0 }}>
                  {badges.map((b, i) => (
                    <StatusPill key={i} label={b.label} tone={b.tone} dot={b.dot} />
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          {fields?.length ? (
            <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
              {fields.map((f, i) => (
                <View key={i} style={[styles.field, i < fields.length - 1 && styles.divider]}>
                  <Text variant="label" tone="muted">
                    {f.label}
                  </Text>
                  <Text variant="body" style={{ color: palette.ink, flexShrink: 1, textAlign: "right" }}>
                    {f.value || "—"}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}

          {sections?.filter((s) => s.body).map((s, i) => (
            <Card key={i} style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">
                {s.title}
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {s.body}
              </Text>
            </Card>
          ))}

          {children}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
