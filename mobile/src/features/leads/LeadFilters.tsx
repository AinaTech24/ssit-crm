/**
 * LeadFilters — the Leads filter + sort sheet, mirroring the web FilterBar:
 * stage / source / owner multi-selects, quick-filter chips (mine, unassigned,
 * hot, stuck, follow-up today/overdue, new this week), a created-date range,
 * and score/recency sort.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { DateField } from "../../components/form/DateField";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { LEAD_STAGES } from "./api";

export interface UiLeadFilters {
  stage: string[];
  source: string[];
  owner: string[];
  quick: string[]; // mine | unassigned | hot | stuck | followup_today | followup_overdue | new_week
  created_from: string;
  created_to: string;
  sort: "score" | "recent";
  dir: "asc" | "desc";
}
export const EMPTY_LEAD_FILTERS: UiLeadFilters = {
  stage: [], source: [], owner: [], quick: [], created_from: "", created_to: "", sort: "score", dir: "desc",
};

const SOURCES = [
  { v: "referral", l: "Client Referral" }, { v: "existing_client", l: "Existing Client" }, { v: "website", l: "Website" },
  { v: "social_media", l: "Social Media" }, { v: "webinar", l: "Webinar" }, { v: "seminar", l: "Seminar" },
  { v: "walk_in", l: "Walk-in" }, { v: "google", l: "Google" }, { v: "cold_call", l: "Cold Call" },
  { v: "manual", l: "Manual" }, { v: "other", l: "Other" },
];
const QUICK = [
  { v: "mine", l: "Mine" }, { v: "unassigned", l: "Unassigned" }, { v: "hot", l: "Hot" }, { v: "stuck", l: "Stuck 14d+" },
  { v: "followup_today", l: "Follow-up today" }, { v: "followup_overdue", l: "Overdue" }, { v: "new_week", l: "New this week" },
];
const SORTS: { key: string; sort: "score" | "recent"; dir: "asc" | "desc"; label: string }[] = [
  { key: "score:desc", sort: "score", dir: "desc", label: "Score — hottest first" },
  { key: "score:asc", sort: "score", dir: "asc", label: "Score — coldest first" },
  { key: "recent:desc", sort: "recent", dir: "desc", label: "Recently updated" },
  { key: "recent:asc", sort: "recent", dir: "asc", label: "Least recently updated" },
];

export function countLeadFilters(f: UiLeadFilters): number {
  return f.stage.length + f.source.length + f.owner.length + f.quick.length + (f.created_from ? 1 : 0) + (f.created_to ? 1 : 0);
}

export function LeadFilters({
  visible, onClose, value, onApply, rmOptions,
}: {
  visible: boolean;
  onClose: () => void;
  value: UiLeadFilters;
  onApply: (f: UiLeadFilters) => void;
  rmOptions: { id: string; name: string | null }[];
}) {
  const [draft, setDraft] = useState<UiLeadFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);

  const toggle = (key: "stage" | "source" | "owner" | "quick", v: string) =>
    setDraft((d) => { const arr = d[key]; return { ...d, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }; });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter & sort">
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        <Group title="Sort by">
          {SORTS.map((s) => {
            const active = draft.sort === s.sort && draft.dir === s.dir;
            return (
              <Pressable key={s.key} style={styles.sortRow} onPress={() => setDraft((d) => ({ ...d, sort: s.sort, dir: s.dir }))}>
                <Text style={{ flex: 1, color: active ? palette.brand : palette.ink, fontWeight: (active ? fontWeight.semibold : fontWeight.regular) as any }}>{s.label}</Text>
                {active ? <Feather name="check" size={16} color={palette.brand} /> : null}
              </Pressable>
            );
          })}
        </Group>

        <ChipGroup title="Quick filters" opts={QUICK} selected={draft.quick} onToggle={(v) => toggle("quick", v)} />
        <ChipGroup title="Stage" opts={LEAD_STAGES.map((s) => ({ v: s.key, l: s.label }))} selected={draft.stage} onToggle={(v) => toggle("stage", v)} />
        <ChipGroup title="Source" opts={SOURCES} selected={draft.source} onToggle={(v) => toggle("source", v)} />
        {rmOptions.length > 0 && (
          <ChipGroup title="Owner (RM)" opts={rmOptions.map((r) => ({ v: r.id, l: r.name ?? "—" }))} selected={draft.owner} onToggle={(v) => toggle("owner", v)} />
        )}

        <Group title="Added (date range)">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><DateField label="From" value={draft.created_from} onChange={(v) => setDraft((d) => ({ ...d, created_from: v }))} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={draft.created_to} onChange={(v) => setDraft((d) => ({ ...d, created_to: v }))} /></View>
          </View>
        </Group>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_LEAD_FILTERS })} style={{ flex: 1 }} />
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
