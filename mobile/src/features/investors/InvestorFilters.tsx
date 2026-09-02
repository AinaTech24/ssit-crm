/**
 * InvestorFilters — the Clients filter + sort sheet, mirroring the web FilterBar
 * and InvestorSortSelect. Multi-select: segment, category, tier, KYC, status, RM
 * + created-date range; single-select sort. Edits a draft, applies on "Apply".
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

export interface UiFilters {
  segment: string[];
  category: string[];
  tier: string[];
  kyc: string[];
  status: string[];
  rm: string[];
  created_from: string;
  created_to: string;
  sort: string; // aum | created | name | sip | health
  dir: "asc" | "desc";
}

export const EMPTY_FILTERS: UiFilters = {
  segment: [], category: [], tier: [], kyc: [], status: [], rm: [],
  created_from: "", created_to: "", sort: "created", dir: "desc",
};

const OPT = {
  segment: [
    { v: "HNI", l: "HNI" }, { v: "Affluent", l: "Affluent" }, { v: "Retail", l: "Retail" },
    { v: "NRI", l: "NRI" }, { v: "Corporate", l: "Corporate" },
  ],
  category: [
    { v: "A", l: "Category A" }, { v: "B", l: "Category B" }, { v: "C", l: "Category C" }, { v: "D", l: "Category D" },
  ],
  tier: [
    { v: "A", l: "A — Quarterly" }, { v: "B", l: "B — Half-yearly" }, { v: "C", l: "C — Annual" },
  ],
  kyc: [
    { v: "verified", l: "Verified" }, { v: "pending", l: "Pending" }, { v: "expired", l: "Expired" }, { v: "rejected", l: "Rejected" },
  ],
  status: [
    { v: "active", l: "Active" }, { v: "dormant", l: "Dormant" }, { v: "inactive", l: "Inactive" },
    { v: "redemption_risk", l: "Redemption risk" }, { v: "closed", l: "Closed" }, { v: "exited", l: "Exited" },
  ],
};

const SORTS: { key: string; sort: string; dir: "asc" | "desc"; label: string }[] = [
  { key: "aum:desc", sort: "aum", dir: "desc", label: "AUM — high to low" },
  { key: "aum:asc", sort: "aum", dir: "asc", label: "AUM — low to high" },
  { key: "created:desc", sort: "created", dir: "desc", label: "Date added — newest" },
  { key: "created:asc", sort: "created", dir: "asc", label: "Date added — oldest" },
  { key: "name:asc", sort: "name", dir: "asc", label: "Name — A to Z" },
  { key: "name:desc", sort: "name", dir: "desc", label: "Name — Z to A" },
  { key: "sip:desc", sort: "sip", dir: "desc", label: "Monthly SIP — high to low" },
  { key: "sip:asc", sort: "sip", dir: "asc", label: "Monthly SIP — low to high" },
  { key: "health:asc", sort: "health", dir: "asc", label: "Health — worst first" },
  { key: "health:desc", sort: "health", dir: "desc", label: "Health — best first" },
];

export function countActive(f: UiFilters): number {
  return f.segment.length + f.category.length + f.tier.length + f.kyc.length + f.status.length + f.rm.length +
    (f.created_from ? 1 : 0) + (f.created_to ? 1 : 0);
}

export function InvestorFilters({
  visible, onClose, value, onApply, rmOptions,
}: {
  visible: boolean;
  onClose: () => void;
  value: UiFilters;
  onApply: (f: UiFilters) => void;
  rmOptions: { id: string; name: string | null }[];
}) {
  const [draft, setDraft] = useState<UiFilters>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible]);

  const toggle = (key: keyof UiFilters, v: string) => {
    setDraft((d) => {
      const arr = d[key] as string[];
      return { ...d, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] };
    });
  };

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

        <ChipGroup title="Segment" opts={OPT.segment} selected={draft.segment} onToggle={(v) => toggle("segment", v)} />
        <ChipGroup title="Client category" opts={OPT.category} selected={draft.category} onToggle={(v) => toggle("category", v)} />
        <ChipGroup title="Service tier" opts={OPT.tier} selected={draft.tier} onToggle={(v) => toggle("tier", v)} />
        <ChipGroup title="KYC" opts={OPT.kyc} selected={draft.kyc} onToggle={(v) => toggle("kyc", v)} />
        <ChipGroup title="Status" opts={OPT.status} selected={draft.status} onToggle={(v) => toggle("status", v)} />
        {rmOptions.length > 0 && (
          <ChipGroup title="Relationship manager" opts={rmOptions.map((r) => ({ v: r.id, l: r.name ?? "—" }))} selected={draft.rm} onToggle={(v) => toggle("rm", v)} />
        )}

        <Group title="Added (date range)">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={draft.created_from} onChange={(v) => setDraft((d) => ({ ...d, created_from: v }))} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="To" value={draft.created_to} onChange={(v) => setDraft((d) => ({ ...d, created_to: v }))} />
            </View>
          </View>
        </Group>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Clear all" variant="secondary" onPress={() => setDraft({ ...EMPTY_FILTERS })} style={{ flex: 1 }} />
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
      <View style={styles.chips}>
        {opts.map((o) => <Chip key={o.v} label={o.l} selected={selected.includes(o.v)} onPress={() => onToggle(o.v)} />)}
      </View>
    </Group>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sortRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.lineSoft },
  footer: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
});
