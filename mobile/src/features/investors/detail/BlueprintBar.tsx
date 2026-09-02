/**
 * Onboarding blueprint bar — the client's journey stages with done / current /
 * upcoming / skipped status. Parity with the web InvestorBlueprintStageBar.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../components/ui/Text";
import { Section, Empty } from "./primitives";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useBlueprint, type BlueprintStage } from "./subfeatures";

const TONE: Record<string, string> = { done: palette.success, current: palette.brand, upcoming: palette.faint, skipped: palette.line };

export function BlueprintBar({ id }: { id: string }) {
  const { data } = useBlueprint(id);
  if (!data) return null;
  const stages = data.allStages ?? [];
  const doneCount = stages.filter((s) => s.status === "done").length;

  return (
    <Section title="Onboarding blueprint" icon="map" right={<Text variant="caption" tone="faint">{doneCount}/{stages.length}</Text>}>
      {stages.length === 0 ? <Empty text="No blueprint stages." /> : (
        <>
          {data.current?.name ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>Current: <Text style={{ fontWeight: fontWeight.semibold as any, color: palette.brand }}>{data.current.name}</Text></Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
            {stages.map((s: BlueprintStage) => (
              <View key={s.key} style={styles.step}>
                <View style={[styles.node, { backgroundColor: s.status === "done" ? palette.success : s.status === "current" ? palette.brand : palette.surfaceSunken, borderColor: TONE[s.status] ?? palette.line }]}>
                  {s.status === "done" ? <Feather name="check" size={12} color="#fff" /> : <Text style={{ fontSize: 10, color: s.status === "current" ? "#fff" : palette.muted, fontWeight: fontWeight.bold as any }}>{s.order}</Text>}
                </View>
                <Text variant="caption" tone={s.status === "current" ? "brand" : "faint"} numberOfLines={2} style={styles.stepLabel}>{s.name}</Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  step: { width: 76, alignItems: "center", gap: 4 },
  node: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepLabel: { textAlign: "center", fontSize: 10 },
});
