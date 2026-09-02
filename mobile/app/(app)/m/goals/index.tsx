/**
 * Goals / Goal Planning — web parity. KPI ribbon (total / on-track / behind /
 * achieved / not-started / reviews-overdue), search + a sort/status filter sheet,
 * an upgraded goal card (client · target · progress · required SIP · gap), and a
 * FAB to add a goal (picks the client inside the form). Tap → detail.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { GoalFilters, EMPTY_GOAL_FILTERS, countGoalFilters, type UiGoalFilters } from "../../../../src/features/goals/GoalFilters";
import { useGoals, useDeleteGoal, goalStatusBadge, categoryLabel, type Goal } from "../../../../src/features/goals/api";
import { inr, fmtDate, toNumber } from "../../../../src/lib/format";
import { confirmDelete } from "../../../../src/lib/confirm";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

function GoalCard({ g, onPress, onLong }: { g: Goal; onPress: () => void; onLong: () => void }) {
  const st = goalStatusBadge(g.status);
  const pct = Math.min(100, Math.round(toNumber(g.progressPct)));
  const gap = toNumber(g.gapAmount);
  const req = toNumber(g.requiredMonthlySip);
  return (
    <Card onPress={onPress} onLongPress={onLong} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.icon}><Feather name="target" size={18} color={palette.violet} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>{g.name}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {categoryLabel(g.category)}{g.investorName ? ` · ${g.investorName}` : ""} · {fmtDate(g.targetDate)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontWeight: fontWeight.bold as any }}>{inr(g.targetAmount)}</Text>
          <StatusPill label={st.label} tone={st.tone} size="sm" dot={false} />
        </View>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: st.tone === "warning" ? palette.warning : palette.success }]} /></View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text variant="caption" tone="muted">{pct}% funded{req > 0 ? ` · req SIP ${inr(req)}/mo` : ""}</Text>
        {gap > 0 ? <Text variant="caption" style={{ color: palette.danger }}>gap {inr(gap)}</Text> : <Text variant="caption" style={{ color: palette.success }}>on target</Text>}
      </View>
    </Card>
  );
}

function StatTile({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <View style={styles.statTile}>
      <Text style={{ fontSize: 20, fontWeight: fontWeight.bold as any, color: value > 0 ? tone : palette.ink }}>{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
    </View>
  );
}

export default function GoalsList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<UiGoalFilters>({ ...EMPTY_GOAL_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rowAction, setRowAction] = useState<Goal | null>(null);
  const debounced = useDebounced(search);
  const del = useDeleteGoal();

  const apiFilters = useMemo(() => ({ q: debounced, status: filters.status.join(","), sort: filters.sort }), [debounced, filters]);
  const { data, isLoading, isError, error, refetch, isRefetching } = useGoals(apiFilters);
  const goals = data?.goals ?? [];
  const stats = data?.stats;
  const activeCount = countGoalFilters(filters);

  const open = (id: string) => router.push(`/m/goals/${id}`);
  const doDelete = (g: Goal) => { setRowAction(null); confirmDelete({ title: `Archive ${g.name}?`, message: "The goal is archived (status → abandoned).", confirmLabel: "Archive" }, () => del.mutate(g.id)); };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      {stats ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          <StatTile tone={palette.brand} label="Total goals" value={stats.total ?? 0} />
          <StatTile tone={palette.success} label="On track" value={stats.on_track ?? 0} />
          <StatTile tone={palette.warning} label="Behind" value={stats.behind ?? 0} />
          <StatTile tone={palette.info} label="Achieved" value={stats.achieved ?? 0} />
          <StatTile tone={palette.warning} label="Not started" value={stats.not_started ?? 0} />
          <StatTile tone={palette.danger} label="Reviews due" value={stats.reviews_overdue ?? 0} />
        </ScrollView>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search goal or client…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>Filter & sort{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_GOAL_FILTERS })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Goal Planning" subtitle={isLoading ? undefined : `${goals.length} goal${goals.length === 1 ? "" : "s"}`} onBack={() => router.back()} />
      {isLoading ? (
        <>
          <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
          <SkeletonList count={6} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={goals}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => <GoalCard g={item} onPress={() => open(item.id)} onLong={() => setRowAction(item)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={debounced || activeCount ? <SearchEmptyState query={debounced || "these filters"} /> : <EmptyState icon="target" title="No goals yet" message="Add a goal to compute the required SIP and gap live." />}
        />
      )}
      <FAB icon="plus" onPress={() => router.push("/m/goals/new" as any)} />

      <GoalFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} />

      <BottomSheet visible={!!rowAction} onClose={() => setRowAction(null)} title={rowAction?.name ?? "Goal"}>
        <Button label="Open goal" variant="secondary" full icon={<Feather name="external-link" size={15} color={palette.ink} />} onPress={() => { const id = rowAction?.id; setRowAction(null); if (id) open(id); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Archive goal" variant="danger" full loading={del.isPending} icon={<Feather name="archive" size={15} color="#fff" />} onPress={() => rowAction && doDelete(rowAction)} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingTop: spacing.sm },
  statTile: { width: 104, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  icon: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: palette.violetBg, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceSunken, overflow: "hidden", marginTop: spacing.md },
  fill: { height: 6, borderRadius: 3 },
});
