/**
 * ActivityFilters — "Logged by me" toggle + an occurred-on date range for the
 * Calls/Activities list (kind is a quick-chip row on the list itself).
 */

import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { DateField } from "../../components/form/DateField";
import { spacing } from "../../theme/tokens";

export interface UiActivityFilters {
  mine: boolean;
  from: string;
  to: string;
}
export const EMPTY_ACTIVITY_FILTERS: UiActivityFilters = { mine: false, from: "", to: "" };

export function countActivityFilters(f: UiActivityFilters): number {
  return (f.mine ? 1 : 0) + (f.from ? 1 : 0) + (f.to ? 1 : 0);
}

export function ActivityFilters({ visible, onClose, value, onApply }: { visible: boolean; onClose: () => void; value: UiActivityFilters; onApply: (f: UiActivityFilters) => void }) {
  const [draft, setDraft] = useState<UiActivityFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter">
      <View style={{ gap: spacing.lg }}>
        <Group title="Owner">
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Chip label="Everyone" selected={!draft.mine} onPress={() => setDraft((d) => ({ ...d, mine: false }))} />
            <Chip label="Logged by me" selected={draft.mine} onPress={() => setDraft((d) => ({ ...d, mine: true }))} />
          </View>
        </Group>
        <Group title="Occurred (date range)">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><DateField label="From" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} /></View>
          </View>
        </Group>
      </View>
      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_ACTIVITY_FILTERS })} style={{ flex: 1 }} />
        <Button label="Apply" onPress={() => { onApply(draft); onClose(); }} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text variant="label" tone="muted" style={{ letterSpacing: 0.5, marginBottom: spacing.sm }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
});
