/**
 * MeetingFilters — the Review-Meetings filter + sort sheet, mirroring the web
 * list page: category / status / mode / type / RM multi-selects, a meeting-date
 * range, and meeting-date sort (soonest / latest).
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { DateField } from "../../components/form/DateField";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { titleCase } from "../../lib/format";
import { MEETING_STATUSES, MEETING_MODES, MEETING_CATEGORIES, MEETING_TYPES } from "./api";

export interface UiMeetingFilters {
  category: string[];
  status: string[];
  mode: string[];
  type: string[];
  rm: string[];
  meeting_from: string;
  meeting_to: string;
  sort: "meeting_desc" | "meeting_asc";
}
export const EMPTY_MEETING_FILTERS: UiMeetingFilters = {
  category: [], status: [], mode: [], type: [], rm: [], meeting_from: "", meeting_to: "", sort: "meeting_desc",
};

const SORTS: { key: "meeting_desc" | "meeting_asc"; label: string }[] = [
  { key: "meeting_desc", label: "Meeting date — latest first" },
  { key: "meeting_asc", label: "Meeting date — soonest first" },
];

export function countMeetingFilters(f: UiMeetingFilters): number {
  return f.category.length + f.status.length + f.mode.length + f.type.length + f.rm.length + (f.meeting_from ? 1 : 0) + (f.meeting_to ? 1 : 0);
}

export function MeetingFilters({
  visible, onClose, value, onApply, rmOptions,
}: {
  visible: boolean;
  onClose: () => void;
  value: UiMeetingFilters;
  onApply: (f: UiMeetingFilters) => void;
  rmOptions: { id: string; name: string | null }[];
}) {
  const [draft, setDraft] = useState<UiMeetingFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);

  const toggle = (key: "category" | "status" | "mode" | "type" | "rm", v: string) =>
    setDraft((d) => { const arr = d[key]; return { ...d, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }; });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter & sort">
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
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

        <ChipGroup title="Category" opts={MEETING_CATEGORIES.map((c) => ({ v: c.value, l: c.label }))} selected={draft.category} onToggle={(v) => toggle("category", v)} />
        <ChipGroup title="Status" opts={MEETING_STATUSES.map((s) => ({ v: s, l: titleCase(s) }))} selected={draft.status} onToggle={(v) => toggle("status", v)} />
        <ChipGroup title="Mode" opts={MEETING_MODES.map((m) => ({ v: m, l: titleCase(m) }))} selected={draft.mode} onToggle={(v) => toggle("mode", v)} />
        <ChipGroup title="Meeting type" opts={MEETING_TYPES.map((t) => ({ v: t, l: titleCase(t) }))} selected={draft.type} onToggle={(v) => toggle("type", v)} />
        {rmOptions.length > 0 && (
          <ChipGroup title="RM" opts={rmOptions.map((r) => ({ v: r.id, l: r.name ?? "—" }))} selected={draft.rm} onToggle={(v) => toggle("rm", v)} />
        )}

        <Group title="Meeting date (range)">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><DateField label="From" value={draft.meeting_from} onChange={(v) => setDraft((d) => ({ ...d, meeting_from: v }))} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={draft.meeting_to} onChange={(v) => setDraft((d) => ({ ...d, meeting_to: v }))} /></View>
          </View>
        </Group>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_MEETING_FILTERS })} style={{ flex: 1 }} />
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
function ChipGroup({ title, opts, selected, onToggle }: { title: string; opts: { v: string; l: string }[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <Group title={title}>
      <View style={styles.chips}>{opts.map((o) => <Chip key={o.v} label={o.l} selected={selected.includes(o.v)} onPress={() => onToggle(o.v)} />)}</View>
    </Group>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sortRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.lineSoft },
  footer: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
});
