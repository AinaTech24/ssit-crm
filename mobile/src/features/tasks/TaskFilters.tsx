/**
 * TaskFilters — the Tasks filter + sort sheet (status / priority / type /
 * department / assignee multi-selects + created range + sort). The view tabs
 * (all / to-me / by-me) and the due quick-filters (KPI cards) live on the tab.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { DateField } from "../../components/form/DateField";
import { titleCase } from "../../lib/format";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { TASK_STATUSES, TASK_PRIORITIES, TASK_TYPES, TASK_DEPARTMENTS } from "./api";

export interface UiTaskFilters {
  status: string[];
  priority: string[];
  type: string[];
  department: string[];
  assignee: string[];
  created_from: string;
  created_to: string;
  sort: "created" | "created_asc" | "due" | "due_desc" | "priority";
}
export const EMPTY_TASK_FILTERS: UiTaskFilters = {
  status: [], priority: [], type: [], department: [], assignee: [], created_from: "", created_to: "", sort: "created",
};

const SORTS: { key: UiTaskFilters["sort"]; label: string }[] = [
  { key: "created", label: "Newest first" },
  { key: "created_asc", label: "Oldest first" },
  { key: "due", label: "Due — soonest first" },
  { key: "due_desc", label: "Due — latest first" },
  { key: "priority", label: "Priority — highest first" },
];

export function countTaskFilters(f: UiTaskFilters): number {
  return f.status.length + f.priority.length + f.type.length + f.department.length + f.assignee.length + (f.created_from ? 1 : 0) + (f.created_to ? 1 : 0);
}

export function TaskFilters({
  visible, onClose, value, onApply, rmOptions,
}: {
  visible: boolean;
  onClose: () => void;
  value: UiTaskFilters;
  onApply: (f: UiTaskFilters) => void;
  rmOptions: { id: string; name: string | null }[];
}) {
  const [draft, setDraft] = useState<UiTaskFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);
  const toggle = (key: "status" | "priority" | "type" | "department" | "assignee", v: string) =>
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
        <ChipGroup title="Status" opts={TASK_STATUSES.map((s) => ({ v: s.key, l: s.label }))} selected={draft.status} onToggle={(v) => toggle("status", v)} />
        <ChipGroup title="Priority" opts={TASK_PRIORITIES.map((p) => ({ v: p.key, l: p.label }))} selected={draft.priority} onToggle={(v) => toggle("priority", v)} />
        <ChipGroup title="Type" opts={TASK_TYPES.map((t) => ({ v: t, l: titleCase(t) }))} selected={draft.type} onToggle={(v) => toggle("type", v)} />
        <ChipGroup title="Department" opts={TASK_DEPARTMENTS.map((d) => ({ v: d, l: titleCase(d) }))} selected={draft.department} onToggle={(v) => toggle("department", v)} />
        {rmOptions.length > 0 && <ChipGroup title="Assignee" opts={rmOptions.map((r) => ({ v: r.id, l: r.name ?? "—" }))} selected={draft.assignee} onToggle={(v) => toggle("assignee", v)} />}
        <Group title="Created (date range)">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><DateField label="From" value={draft.created_from} onChange={(v) => setDraft((d) => ({ ...d, created_from: v }))} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={draft.created_to} onChange={(v) => setDraft((d) => ({ ...d, created_to: v }))} /></View>
          </View>
        </Group>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_TASK_FILTERS })} style={{ flex: 1 }} />
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
