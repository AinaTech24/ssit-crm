/**
 * Tasks tab — web parity. KPI strip (Open / Due today / Overdue / SLA at risk),
 * view tabs (All / To me / By me / Board), search + a full filter & sort sheet,
 * and a list or a status kanban. Tap → task detail; create FAB.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { FAB } from "../../../../src/components/ui/FAB";
import { Text } from "../../../../src/components/ui/Text";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { TaskCard } from "../../../../src/components/domain/TaskCard";
import { TaskFilters, EMPTY_TASK_FILTERS, countTaskFilters, type UiTaskFilters } from "../../../../src/features/tasks/TaskFilters";
import { useTasks, useTaskKpis, groupTasksByStatus } from "../../../../src/features/tasks/api";
import { useTeam } from "../../../../src/features/team/api";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

type TaskView = "" | "to_me" | "by_me" | "kanban";
type Due = "" | "today" | "overdue" | "sla_risk";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

export default function TasksTab() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<TaskView>("");
  const [due, setDue] = useState<Due>("");
  const [filters, setFilters] = useState<UiTaskFilters>({ ...EMPTY_TASK_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounced = useDebounced(search);
  const rmOptions = useTeam().data?.rows ?? [];
  const isKanban = view === "kanban";

  const apiFilters = useMemo(() => ({
    q: debounced, view, due: isKanban ? "" as Due : due,
    status: filters.status.join(","), priority: filters.priority.join(","), type: filters.type.join(","),
    department: filters.department.join(","), assignee: filters.assignee.join(","),
    created_from: filters.created_from, created_to: filters.created_to, sort: filters.sort,
  }), [debounced, view, due, filters, isKanban]);

  const { data, isLoading, isError, error, refetch, isRefetching } = useTasks(apiFilters);
  const { data: kpis } = useTaskKpis(apiFilters);
  const tasks = data?.tasks ?? [];
  const columns = useMemo(() => groupTasksByStatus(tasks), [tasks]);
  const activeCount = countTaskFilters(filters);

  const toggleDue = (d: Due) => setDue((cur) => (cur === d ? "" : d));

  const header = (
    <View style={styles.controls}>
      {kpis && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiStrip}>
          <Kpi icon="inbox" tone={palette.brand} label="Open" value={kpis.open} active={due === ""} onPress={() => setDue("")} />
          <Kpi icon="sun" tone={palette.warning} label="Due today" value={kpis.today} active={due === "today"} onPress={() => toggleDue("today")} />
          <Kpi icon="alert-circle" tone={palette.danger} label="Overdue" value={kpis.overdue} active={due === "overdue"} onPress={() => toggleDue("overdue")} />
          <Kpi icon="clock" tone={palette.violet} label="SLA at risk" value={kpis.slaRisk} active={due === "sla_risk"} onPress={() => toggleDue("sla_risk")} />
        </ScrollView>
      )}
      <Segmented<TaskView> options={[{ key: "", label: "All" }, { key: "to_me", label: "To me" }, { key: "by_me", label: "By me" }, { key: "kanban", label: "Board" }]} value={view} onChange={setView} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search tasks…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>Filter & sort{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_TASK_FILTERS })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      {isLoading ? (<><View style={{ paddingHorizontal: spacing.lg }}>{header}</View><SkeletonList count={6} /></>)
      : isError ? <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      : isKanban ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
            {columns.map((col) => (
              <View key={col.key} style={styles.column}>
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: toneColor(col.tone) }]} />
                  <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>{col.label}</Text>
                  <View style={styles.countBadge}><Text variant="caption" tone="muted">{col.tasks.length}</Text></View>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {col.tasks.map((t) => <TaskCard key={t.id} task={t} compact onPress={() => router.push(`/m/tasks/${t.id}`)} />)}
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <FlashList
          data={tasks}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TaskCard task={item} onPress={() => router.push(`/m/tasks/${item.id}`)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={debounced || activeCount || due ? <SearchEmptyState query={debounced || "these filters"} /> : <EmptyState icon="check-square" title="No tasks" message="You're all caught up." />}
        />
      )}
      <FAB onPress={() => router.push("/m/tasks/new" as any)} />
      <TaskFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} rmOptions={rmOptions} />
    </View>
  );
}

function Kpi({ icon, tone, label, value, active, onPress }: { icon: string; tone: string; label: string; value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.kpi, active && { borderColor: tone, backgroundColor: tone + "12" }]}>
      <View style={styles.kpiHead}><Feather name={icon as any} size={13} color={tone} /><Text variant="caption" tone="muted">{label}</Text></View>
      <Text style={{ fontSize: 20, fontWeight: fontWeight.bold as any, color: active ? tone : palette.ink }}>{value}</Text>
    </Pressable>
  );
}
function toneColor(t: string): string {
  return t === "success" ? palette.success : t === "warning" ? palette.warning : t === "danger" ? palette.danger : t === "violet" ? palette.violet : t === "info" ? palette.info : palette.muted;
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  kpiStrip: { gap: spacing.sm, paddingBottom: spacing.xs },
  kpi: { width: 108, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  board: { paddingHorizontal: spacing.lg, paddingBottom: 96, gap: spacing.md },
  column: { width: 230, backgroundColor: palette.surfaceSunken, borderRadius: 14, padding: spacing.sm, marginRight: spacing.md },
  colHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  countBadge: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
