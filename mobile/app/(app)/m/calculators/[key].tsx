/**
 * A single calculator, rendered entirely from its registry definition: inputs on
 * top, live results below, and a one-tap WhatsApp share of the result summary —
 * the whole point of a field calculator is to show a prospect and send it over.
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { calcByKey } from "../../../../src/features/calculators/registry";
import { CalcInput, ResultBlockView, resultsToText } from "../../../../src/features/calculators/CalcUI";
import { useTenant } from "../../../../src/features/settings/api";
import { toast } from "../../../../src/lib/toast";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

export default function CalculatorScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const tenant = useTenant();
  const def = calcByKey(String(key));

  // Seed values from the definition's defaults (once).
  const [values, setValues] = React.useState<Record<string, any>>(() => {
    const seed: Record<string, any> = {};
    def?.inputs.forEach((i) => { seed[i.key] = i.default; });
    return seed;
  });

  if (!def) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Calculator" />
        <View style={{ padding: spacing.xl }}><Text variant="body" tone="muted">This calculator doesn't exist.</Text></View>
      </View>
    );
  }

  const set = (k: string, v: any) => setValues((prev) => ({ ...prev, [k]: v }));
  const visibleInputs = def.inputs.filter((i) => !i.visibleIf || i.visibleIf(values));

  let blocks: ReturnType<typeof def.compute> = [];
  let computeError = false;
  try { blocks = def.compute(values); } catch { computeError = true; }

  const t = tenant.data?.tenant ?? tenant.data;
  const firm = t?.displayName || t?.legalName || "Your advisor";
  const share = () => {
    const text = resultsToText(def.name, firm, blocks);
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => toast.error("Couldn't open WhatsApp"));
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader
        title={def.name}
        subtitle={def.desc}
        right={<Pressable onPress={share} hitSlop={8} style={styles.shareBtn}><Feather name="share-2" size={16} color={palette.white} /></Pressable>}
      />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Inputs */}
        <Card>
          {visibleInputs.map((spec) => (
            <CalcInput key={spec.key} spec={spec} value={values[spec.key]} onChange={(v) => set(spec.key, v)} />
          ))}
        </Card>

        {/* Results */}
        <View style={{ marginTop: spacing.xl }}>
          {computeError ? (
            <Card flat><Text variant="body" tone="muted">Enter valid numbers to see the result.</Text></Card>
          ) : (
            blocks.map((b, i) => <ResultBlockView key={i} block={b} />)
          )}
        </View>

        {/* Share CTA */}
        <Pressable style={styles.shareCta} onPress={share}>
          <Feather name="message-circle" size={16} color={palette.white} />
          <Text style={{ color: palette.white, fontWeight: fontWeight.semibold as any }}>Share on WhatsApp</Text>
        </Pressable>
        <Text variant="caption" tone="faint" style={{ textAlign: "center", marginTop: spacing.md }}>
          Illustration only. Mutual fund investments are subject to market risks.
        </Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  shareBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.success, alignItems: "center", justifyContent: "center" },
  shareCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.success, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xl },
});
