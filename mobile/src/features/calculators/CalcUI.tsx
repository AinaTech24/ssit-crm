/**
 * Shared calculator UI: the input row renderer and the ResultBlock renderer.
 * Both are driven purely by the calculator definition, so every calculator
 * screen looks and behaves identically.
 */

import React from "react";
import { View, TextInput, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Segmented } from "../../components/ui/Segmented";
import { inr } from "../../lib/format";
import { spacing, palette, radius, fontSize, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";
import type { InputSpec, ResultBlock, Tone } from "./types";

const TONE_FALLBACK: Tone = "neutral";

/** A single numeric field with an inline unit suffix (₹ / % / yrs). */
function NumberInput({ spec, value, onChange }: { spec: InputSpec; value: number; onChange: (n: number) => void }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => { setText(value === 0 ? "" : String(value)); }, [value]);
  const unit = spec.type === "money" ? "₹" : spec.type === "percent" ? "%" : spec.type === "years" ? "yrs" : "";
  const commit = (t: string) => {
    setText(t);
    const n = parseFloat(t.replace(/,/g, ""));
    onChange(isFinite(n) ? n : 0);
  };
  return (
    <View style={styles.field}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs }}>
        <Text variant="label" tone="muted">{spec.label}</Text>
        {spec.type === "money" && value > 0 ? <Text variant="caption" tone="faint">{inr(value)}</Text> : null}
      </View>
      <View style={styles.inputWrap}>
        {unit === "₹" ? <Text style={styles.unitLead}>₹</Text> : null}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={commit}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={palette.faint}
          selectTextOnFocus
        />
        {unit && unit !== "₹" ? <Text style={styles.unitTrail}>{unit}</Text> : null}
      </View>
      {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
    </View>
  );
}

/** Renders any input spec to the right control. */
export function CalcInput({ spec, value, onChange }: { spec: InputSpec; value: any; onChange: (v: any) => void }) {
  if (spec.type === "segmented") {
    return (
      <View style={styles.field}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{spec.label}</Text>
        <Segmented
          options={(spec.options ?? []).map((o) => ({ key: o.value, label: o.label }))}
          value={String(value)}
          onChange={(v) => onChange(v)}
        />
        {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
      </View>
    );
  }
  if (spec.type === "toggle") {
    return (
      <Pressable style={[styles.field, styles.toggleRow]} onPress={() => onChange(!value)}>
        <View style={{ flex: 1 }}>
          <Text variant="body">{spec.label}</Text>
          {spec.hint ? <Text variant="caption" tone="faint">{spec.hint}</Text> : null}
        </View>
        <View style={[styles.switch, value && styles.switchOn]}>
          <View style={[styles.knob, value && styles.knobOn]} />
        </View>
      </Pressable>
    );
  }
  return <NumberInput spec={spec} value={Number(value) || 0} onChange={onChange} />;
}

/** Renders a single ResultBlock. */
export function ResultBlockView({ block }: { block: ResultBlock }) {
  if (block.type === "section") {
    return <Text variant="caption" tone="faint" style={styles.section}>{block.text.toUpperCase()}</Text>;
  }
  if (block.type === "stat") {
    const tc = toneColors((block.tone ?? TONE_FALLBACK) as any);
    return (
      <View style={[styles.stat, { backgroundColor: tc.bg }]}>
        <Text variant="caption" style={{ color: tc.fg, fontWeight: fontWeight.medium as any }}>{block.label}</Text>
        <Text style={[styles.statValue, { color: tc.fg }]}>{block.value}</Text>
        {block.hint ? <Text variant="caption" style={{ color: tc.fg, opacity: 0.8 }}>{block.hint}</Text> : null}
      </View>
    );
  }
  if (block.type === "insight") {
    const tc = toneColors((block.tone ?? "brand") as any);
    return (
      <View style={[styles.insight, { backgroundColor: tc.bg, borderLeftColor: tc.fg }]}>
        <Feather name="info" size={14} color={tc.fg} style={{ marginTop: 2 }} />
        <Text variant="caption" style={{ color: palette.ink, flex: 1, lineHeight: 18 }}>{block.text}</Text>
      </View>
    );
  }
  // table
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        {block.head.map((h, i) => (
          <Text key={i} variant="caption" style={[styles.th, i === 0 && styles.thFirst]} numberOfLines={1}>{h}</Text>
        ))}
      </View>
      {block.rows.map((row, ri) => (
        <View key={ri} style={[styles.tr, ri % 2 === 1 && styles.trAlt]}>
          {row.map((cell, ci) => (
            <Text key={ci} variant="caption" style={[styles.td, ci === 0 && styles.tdFirst]} numberOfLines={1}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Flatten result blocks into a shareable plain-text summary (WhatsApp). */
export function resultsToText(name: string, firm: string, blocks: ResultBlock[]): string {
  const lines: string[] = [`*${name}*`];
  for (const b of blocks) {
    if (b.type === "section") lines.push(`\n_${b.text}_`);
    else if (b.type === "stat") lines.push(`${b.label}: *${b.value}*`);
    else if (b.type === "insight") lines.push(`💡 ${b.text}`);
    else if (b.type === "table") {
      lines.push(b.head.join(" | "));
      b.rows.slice(0, 12).forEach((r) => lines.push(r.join(" | ")));
    }
  }
  lines.push(`\n_Illustration by ${firm}. Mutual fund investments are subject to market risks._`);
  return lines.join("\n");
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: spacing.lg },
  input: { flex: 1, fontSize: fontSize.lg, color: palette.ink, paddingVertical: spacing.md, fontWeight: fontWeight.semibold as any },
  unitLead: { fontSize: fontSize.lg, color: palette.muted, marginRight: 4, fontWeight: fontWeight.semibold as any },
  unitTrail: { fontSize: fontSize.md, color: palette.muted, marginLeft: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: palette.line, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: palette.brand },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.white },
  knobOn: { alignSelf: "flex-end" },
  section: { letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  stat: { borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  statValue: { fontSize: 24, fontWeight: fontWeight.bold as any, marginTop: 2, letterSpacing: -0.4 },
  insight: { flexDirection: "row", gap: spacing.sm, borderRadius: radius.md, borderLeftWidth: 3, padding: spacing.md, marginBottom: spacing.sm },
  table: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, overflow: "hidden", marginBottom: spacing.sm },
  tr: { flexDirection: "row", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  thead: { backgroundColor: palette.surfaceSunken },
  trAlt: { backgroundColor: palette.surfaceAlt },
  th: { flex: 1, textAlign: "right", fontWeight: fontWeight.semibold as any, color: palette.muted },
  thFirst: { flex: 1.4, textAlign: "left" },
  td: { flex: 1, textAlign: "right", color: palette.ink },
  tdFirst: { flex: 1.4, textAlign: "left", color: palette.muted },
});
