/**
 * GoalFilters — sort + status filter sheet for the Goals list. Sort mirrors the
 * web FilterBar (target date / target ₹); status is a mobile convenience chip set.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { GOAL_STATUSES } from "./api";

export interface UiGoalFilters {
  status: string[];
  sort: "target_date_asc" | "target_date_desc" | "target_amount_desc" | "target_amount_asc";
}
export const EMPTY_GOAL_FILTERS: UiGoalFilters = { status: [], sort: "target_date_asc" };

const SORTS: { key: UiGoalFilters["sort"]; label: string }[] = [
  { key: "target_date_asc", label: "Target date — soonest first" },
  { key: "target_date_desc", label: "Target date — latest first" },
  { key: "target_amount_desc", label: "Target ₹ — high to low" },
  { key: "target_amount_asc", label: "Target ₹ — low to high" },
];

export function countGoalFilters(f: UiGoalFilters): number {
  return f.status.length;
}

export function GoalFilters({ visible, onClose, value, onApply }: { visible: boolean; onClose: () => void; value: UiGoalFilters; onApply: (f: UiGoalFilters) => void }) {
  const [draft, setDraft] = useState<UiGoalFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);

  const toggle = (v: string) => setDraft((d) => ({ ...d, status: d.status.includes(v) ? d.status.filter((x) => x !== v) : [...d.status, v] }));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter & sort">
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        <Group title="Sort by">
          {SORTS.map((s) => {
            const active = draft.sort === s.key;
            return (
              <Pressable key={s.key} style={styles.sortRow} onPress={() => setDraft((d) => ({ ...d, sort: s.key }))}>
                <Text style={{ flex: 1, color: active ? palette.brand : palette.ink, fontWeight: (active ? fontWeight.semibold : fontWeight.regular) as any }}>{s.label}</Text>
                {active ? <Feather name="check" size={16} color={palette.brand} /> : null}
              </Pressable>
            );
          })}
        </Group>
        <Group title="Status">
          <View style={styles.chips}>
            {GOAL_STATUSES.map((s) => (
              <Chip key={s.value} label={s.label} selected={draft.status.includes(s.value)} onPress={() => toggle(s.value)} />
            ))}
          </View>
        </Group>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_GOAL_FILTERS })} style={{ flex: 1 }} />
        <Button label="Apply" onPress={() => { onApply(draft); onClose(); }} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ letterSpacing: 0.5, marginBottom: spacing.sm }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sortRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.lineSoft },
  footer: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
});
