/**
 * Leads / Pipeline — web parity. List or Board (kanban by the 10 canonical
 * stages). Search + a full filter/sort sheet (stage / source / owner / quick
 * filters / date + score/recency sort). Tap → detail; long-press → edit / delete.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { FAB } from "../../../../src/components/ui/FAB";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { LeadCard } from "../../../../src/components/domain/LeadCard";
import { LeadFilters, EMPTY_LEAD_FILTERS, countLeadFilters, type UiLeadFilters } from "../../../../src/features/leads/LeadFilters";
import { useLeads, useDeleteLead, filterLeads, groupByStage, type Lead } from "../../../../src/features/leads/api";
import { useTeam } from "../../../../src/features/team/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

export default function LeadsList() {
  const router = useRouter();
  const [view, setView] = useState<"list" | "board">("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<UiLeadFilters>({ ...EMPTY_LEAD_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rowAction, setRowAction] = useState<Lead | null>(null);
  const debounced = useDebounced(search);
  const del = useDeleteLead();
  const rmOptions = useTeam().data?.rows ?? [];

  const apiFilters = useMemo(() => ({
    q: debounced,
    stage: filters.stage.join(","), source: filters.source.join(","), owner: filters.owner.join(","),
    created_from: filters.created_from, created_to: filters.created_to, sort: filters.sort, dir: filters.dir,
    ...Object.fromEntries(filters.quick.map((k) => [k, "1"])),
  }), [debounced, filters]);

  const { data, isLoading, isError, error, refetch, isRefetching } = useLeads(apiFilters);
  const all = data?.leads ?? [];
  const listLeads = useMemo(() => filterLeads(all, debounced), [all, debounced]);
  const columns = useMemo(() => groupByStage(all), [all]);
  const activeCount = countLeadFilters(filters);

  const open = (id: string) => router.push(`/m/leads/${id}`);
  const doDelete = (l: Lead) => {
    setRowAction(null);
    confirmDelete({ title: `Delete ${l.name}?`, message: "The lead is archived and hidden from the pipeline.", confirmLabel: "Delete" }, () => del.mutate(l.id));
  };

  const toolbar = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, phone, email…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>Filter & sort{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_LEAD_FILTERS })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Leads" subtitle={isLoading ? undefined : `${data?.total ?? all.length} in pipeline`} />
      <View style={styles.controls}>
        <Segmented options={[{ key: "list", label: "List" }, { key: "board", label: "Board" }]} value={view} onChange={setView} />
      </View>

      {isLoading ? (
        <><View style={{ paddingHorizontal: spacing.lg }}>{toolbar}</View><SkeletonList count={8} /></>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : view === "list" ? (
        <FlashList
          data={listLeads}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <LeadCard lead={item} onPress={() => open(item.id)} />}
          ListHeaderComponent={toolbar}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={debounced || activeCount ? <SearchEmptyState query={debounced || "these filters"} /> : <EmptyState icon="trending-up" title="No leads" message="New leads will appear here." />}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.lg }}>{toolbar}</View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
            {columns.map((col) => (
              <View key={col.key} style={styles.column}>
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: toneColor(col.tone) }]} />
                  <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{col.label}</Text>
                  <View style={styles.countBadge}><Text variant="caption" tone="muted">{col.leads.length}</Text></View>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {col.leads.map((l) => <LeadCard key={l.id} lead={l} compact onPress={() => open(l.id)} />)}
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <FAB onPress={() => router.push("/m/leads/new" as any)} />

      <LeadFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} rmOptions={rmOptions} />

      <BottomSheet visible={!!rowAction} onClose={() => setRowAction(null)} title={rowAction?.name ?? "Lead"}>
        <Button label="Edit lead" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { const id = rowAction?.id; setRowAction(null); if (id) router.push(`/m/leads/new?editId=${id}` as any); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Delete lead" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={() => rowAction && doDelete(rowAction)} />
      </BottomSheet>
    </View>
  );
}

function toneColor(t: string): string {
  return t === "success" ? palette.success : t === "warning" ? palette.warning : t === "danger" ? palette.danger : t === "violet" ? palette.violet : t === "info" ? palette.info : palette.muted;
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  board: { paddingHorizontal: spacing.lg, paddingBottom: 96, gap: spacing.md },
  column: { width: 230, backgroundColor: palette.surfaceSunken, borderRadius: 14, padding: spacing.sm, marginRight: spacing.md },
  colHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  countBadge: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
