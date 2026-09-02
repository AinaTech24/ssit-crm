/**
 * Calculators gallery — the field rep's "show a prospect live" toolkit, grouped
 * by theme. Tapping a card opens the calculator screen ([key].tsx). Search
 * filters across names + descriptions.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { CALCULATORS, CALC_GROUPS } from "../../../../src/features/calculators/registry";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

export default function CalculatorsGallery() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const term = q.trim().toLowerCase();

  const groups = CALC_GROUPS.map((g) => ({
    title: g,
    items: CALCULATORS.filter((c) => c.group === g && (!term || c.name.toLowerCase().includes(term) || c.desc.toLowerCase().includes(term))),
  })).filter((g) => g.items.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Calculators" subtitle={`${CALCULATORS.length} planning tools`} />
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search calculators…" />
      </View>
      <Screen scroll padded contentStyle={{ paddingTop: spacing.sm, paddingBottom: spacing["3xl"] }}>
        {groups.length === 0 ? (
          <Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>No calculators match "{q}".</Text>
        ) : (
          groups.map((g) => (
            <View key={g.title} style={{ marginBottom: spacing.xl }}>
              <Text variant="caption" tone="faint" style={styles.groupLabel}>{g.title.toUpperCase()}</Text>
              <View style={styles.grid}>
                {g.items.map((c) => (
                  <Pressable key={c.key} style={styles.tile} onPress={() => router.push(`/m/calculators/${c.key}` as any)}>
                    <View style={styles.tileIcon}><Feather name={c.icon} size={18} color={palette.brand} /></View>
                    <Text variant="label" numberOfLines={2} style={{ color: palette.ink }}>{c.name}</Text>
                    <Text variant="caption" tone="faint" numberOfLines={2}>{c.desc}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: { letterSpacing: 0.6, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "47.5%", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  tileIcon: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center", marginBottom: 4 },
});
