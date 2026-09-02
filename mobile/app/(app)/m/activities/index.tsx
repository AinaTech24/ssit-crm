/**
 * Calls / Activities — the interaction log. KPI ribbon (total / calls today /
 * visits this week / follow-ups due), search + kind quick-chips + a filter sheet
 * (logged-by-me · date range), activity cards (who · summary · outcome · when),
 * a FAB to log an activity, and long-press to edit / delete. Tap → the subject.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, Linking, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Chip } from "../../../../src/components/ui/Chip";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { ActivityFilters, EMPTY_ACTIVITY_FILTERS, countActivityFilters, type UiActivityFilters } from "../../../../src/features/activities/ActivityFilters";
import { useActivities, useUpdateActivity, useDeleteActivity, ACTIVITY_KINDS, ACTIVITY_DIRECTIONS, ACTIVITY_OUTCOMES, kindMeta, outcomeBadge, type Activity } from "../../../../src/features/activities/api";
import { CheckInSheet } from "../../../../src/features/activities/CheckInSheet";
import { timeAgo, titleCase } from "../../../../src/lib/format";
import { confirmDelete } from "../../../../src/lib/confirm";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
const call = (phone?: string | null) => { if (phone) Linking.openURL(`tel:${phone}`).catch(() => {}); };

function ActivityCard({ a, onPress, onLong }: { a: Activity; onPress: () => void; onLong: () => void }) {
  const km = kindMeta(a.kind);
  const { fg, bg } = toneColors(km.tone);
  const ob = a.status ? outcomeBadge(a.status) : null;
  const dur = a.duration_sec ? `${Math.round(a.duration_sec / 60)}m` : "";
  return (
    <Card onPress={onPress} onLongPress={onLong} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View style={[styles.icon, { backgroundColor: bg }]}><Feather name={km.icon as any} size={17} color={fg} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>{a.subject_name ?? "—"}</Text>
            <Text variant="caption" tone="faint">{timeAgo(a.occurred_at)}</Text>
          </View>
          {a.subject ? <Text variant="body" numberOfLines={1}>{a.subject}</Text> : null}
          {a.notes ? <Text variant="caption" tone="muted" numberOfLines={2}>{a.notes}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
            <StatusPill label={km.label} tone={km.tone} size="sm" dot={false} />
            {ob ? <StatusPill label={ob.label} tone={ob.tone} size="sm" dot={false} /> : null}
            {a.direction ? <Text variant="caption" tone="faint">{titleCase(a.direction)}</Text> : null}
            {dur ? <Text variant="caption" tone="faint">· {dur}</Text> : null}
            {a.owner_name ? <Text variant="caption" tone="faint">· {a.owner_name}</Text> : null}
          </View>
        </View>
        {a.subject_phone ? (
          <Pressable onPress={() => call(a.subject_phone)} hitSlop={8} style={styles.callBtn}><Feather name="phone" size={15} color={palette.brand} /></Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function StatTile({ icon, tone, label, value }: { icon: string; tone: string; label: string; value: number }) {
  return (
    <View style={styles.statTile}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Feather name={icon as any} size={13} color={tone} />
        <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: fontWeight.bold as any }}>{value}</Text>
    </View>
  );
}

export default function ActivitiesList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [filters, setFilters] = useState<UiActivityFilters>({ ...EMPTY_ACTIVITY_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editRow, setEditRow] = useState<Activity | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const debounced = useDebounced(search);

  const apiFilters = useMemo(() => ({ q: debounced, kind, mine: filters.mine ? "1" : "", from: filters.from, to: filters.to }), [debounced, kind, filters]);
  const { data, isLoading, isError, error, refetch, isRefetching } = useActivities(apiFilters);
  const rows = data?.activities ?? [];
  const stats = data?.stats;
  const activeCount = countActivityFilters(filters);

  const openSubject = (a: Activity) => {
    if (a.subject_type === "investor" && a.subject_id) router.push(`/m/investors/${a.subject_id}` as any);
    else if (a.subject_type === "lead" && a.subject_id) router.push(`/m/leads/${a.subject_id}` as any);
  };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      {stats ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          <StatTile icon="activity" tone={palette.brand} label="Activities" value={stats.total ?? 0} />
          <StatTile icon="phone" tone={palette.info} label="Calls today" value={stats.calls_today ?? 0} />
          <StatTile icon="map-pin" tone={palette.violet} label="Visits (7d)" value={stats.visits_week ?? 0} />
          <StatTile icon="corner-up-right" tone={palette.warning} label="Follow-ups due" value={stats.followups_due ?? 0} />
        </ScrollView>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, summary, notes…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>Filter{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_ACTIVITY_FILTERS })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
        <View style={{ flex: 1 }} />
        <Pressable style={styles.checkinBtn} onPress={() => setCheckinOpen(true)}>
          <Feather name="map-pin" size={15} color={palette.white} />
          <Text style={{ fontWeight: fontWeight.semibold as any, color: palette.white }}>Check in</Text>
        </Pressable>
      </View>
      <View style={styles.chips}>
        <Chip label="All" selected={kind === ""} onPress={() => setKind("")} />
        {ACTIVITY_KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(kind === k.value ? "" : k.value)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Calls & Activities" subtitle={isLoading ? undefined : `${rows.length} logged`} onBack={() => router.back()} />
      {isLoading ? (
        <>
          <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
          <SkeletonList count={6} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => <ActivityCard a={item} onPress={() => router.push(`/m/activities/${item.id}` as any)} onLong={() => setEditRow(item)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={debounced || activeCount || kind ? <SearchEmptyState query={debounced || "these filters"} /> : <EmptyState icon="phone-call" title="No activities yet" message="Tap + to log a call, visit or note." />}
        />
      )}
      <FAB icon="plus" onPress={() => router.push("/m/activities/new" as any)} />

      <ActivityFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} />
      <EditActivitySheet row={editRow} onClose={() => setEditRow(null)} />
      <CheckInSheet visible={checkinOpen} onClose={() => setCheckinOpen(false)} />
    </View>
  );
}

// ── Edit / delete sheet ──
function EditActivitySheet({ row, onClose }: { row: Activity | null; onClose: () => void }) {
  const update = useUpdateActivity(row?.id ?? "");
  const del = useDeleteActivity();
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setSubject(row.subject ?? ""); setNotes(row.notes ?? ""); setStatus(row.status ?? ""); setDirection(row.direction ?? ""); setErr(null);
  }, [row]);

  const save = async () => {
    setErr(null);
    try {
      await update.mutateAsync({ subject: subject || null, notes: notes || null, status: status || null, direction: direction || null });
      onClose();
    } catch (e: any) { setErr(e?.message ?? "Could not save."); }
  };
  const doDelete = () => confirmDelete({ title: "Delete this activity?", message: "It's permanently removed from the log.", confirmLabel: "Delete" }, () => del.mutate(row!.id, { onSuccess: onClose }));

  return (
    <BottomSheet visible={!!row} onClose={onClose} title="Edit activity">
      <TextField label="Summary" value={subject} onChangeText={setSubject} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      <SelectField label="Outcome" value={status} options={[{ value: "", label: "— Not set —" }, ...ACTIVITY_OUTCOMES.map((o) => ({ value: o.value, label: o.label }))]} onChange={setStatus} />
      <SelectField label="Direction" value={direction} options={[{ value: "", label: "— Not set —" }, ...ACTIVITY_DIRECTIONS]} onChange={setDirection} />
      {err ? <Text variant="caption" tone="danger" style={{ marginBottom: spacing.sm }}>{err}</Text> : null}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Button label="Delete" variant="danger" loading={del.isPending} onPress={doDelete} style={{ flex: 1 }} />
        <Button label="Save" loading={update.isPending} onPress={save} style={{ flex: 1 }} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingTop: spacing.sm },
  statTile: { width: 122, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  checkinBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.violet, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  icon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  callBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center", alignSelf: "center" },
});
