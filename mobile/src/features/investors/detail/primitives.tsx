/**
 * Shared presentational primitives for the client-360 detail tabs: titled
 * Section cards, labelled field rows, money/percent formatting, allocation bars,
 * and small badges. Keeps the tab files declarative.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../components/ui/Text";
import { inr, fmtDate, titleCase } from "../../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";

export function Section({ title, icon, right, children }: { title: string; icon?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.secHead}>
        {icon ? <Feather name={icon as any} size={14} color={palette.muted} /> : null}
        <Text variant="label" tone="muted" style={{ letterSpacing: 0.5, flex: 1 }}>{title.toUpperCase()}</Text>
        {right}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function FieldRow({ label, value }: { label: string; value?: string | number | null }) {
  const v = value === 0 ? "0" : value;
  return (
    <View style={styles.fieldRow}>
      <Text variant="label" tone="muted" style={{ flex: 1 }}>{label}</Text>
      <Text variant="body" style={{ flex: 1.4, textAlign: "right", color: palette.ink, fontWeight: fontWeight.medium as any }} numberOfLines={3}>
        {v == null || v === "" ? "—" : String(v)}
      </Text>
    </View>
  );
}

/** Two-column grid of label/value pairs (mobile: stacked rows). */
export function FieldGroup({ title, rows }: { title: string; rows: [string, any][] }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ fontWeight: fontWeight.semibold as any, marginBottom: spacing.xs }}>{title}</Text>
      {rows.map(([l, v], i) => <FieldRow key={i} label={l} value={v} />)}
    </View>
  );
}

export function Money({ value, label }: { value: any; label?: string }) {
  return (
    <View>
      {label ? <Text variant="caption" tone="muted">{label}</Text> : null}
      <Text style={{ fontWeight: fontWeight.bold as any }}>{inr(value)}</Text>
    </View>
  );
}

export function AllocBar({ label, pct, value, tone }: { label: string; pct: number; value?: any; tone: string }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={styles.barHead}>
        <Text variant="caption" style={{ flex: 1 }}>{label}</Text>
        <Text variant="caption" tone="muted">{value != null ? `${inr(value)} · ` : ""}{p.toFixed(1)}%</Text>
      </View>
      <View style={styles.barTrack}><View style={[styles.barFill, { width: `${p}%`, backgroundColor: tone }]} /></View>
    </View>
  );
}

export function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: tone + "1A" }]}>
      <Text style={{ fontSize: 11, color: tone, fontWeight: fontWeight.semibold as any }}>{label}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text tone="muted" variant="caption">{text}</Text>;
}

export const fmt = { inr, fmtDate, titleCase };

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg },
  secHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  barHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, alignSelf: "flex-start" },
});
