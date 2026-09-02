/**
 * Review Meetings — web parity. Stats ribbon (upcoming / this week / completed
 * MTD / overdue), search + a full filter/sort sheet (category / status / mode /
 * type / RM / date range / sort), an upgraded meeting card, and a FAB that opens
 * the schedule form. Tap → detail; long-press → edit / cancel.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
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
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { MeetingFilters, EMPTY_MEETING_FILTERS, countMeetingFilters, type UiMeetingFilters } from "../../../../src/features/meetings/MeetingFilters";
import { useMeetings, useCancelMeeting, MEETING_STATUSES, OUTCOME_TONE, type Meeting } from "../../../../src/features/meetings/api";
import { useTeam } from "../../../../src/features/team/api";
import { meetingStatusBadge } from "../../../../src/lib/status";
import { titleCase } from "../../../../src/lib/format";
import { confirmDelete } from "../../../../src/lib/confirm";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

/** yyyy-mm-dd HH:mm → "3 Jul, 11:00 AM". */
function fmtMeetingWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}

const ACTIVE = new Set(["scheduled", "confirmed", "in_progress"]);
function isOverdue(m: Meeting): boolean {
  if (!m.meeting_date || !ACTIVE.has(m.status ?? "")) return false;
  return new Date(m.meeting_date).getTime() < Date.now();
}

function MeetingCard({ meeting, onPress, onLong }: { meeting: Meeting; onPress: () => void; onLong: () => void }) {
  const st = meetingStatusBadge(meeting.status);
  const overdue = isOverdue(meeting);
  const who = meeting.subject_name ?? meeting.investor_name ?? meeting.lead_name;
  return (
    <Card onPress={onPress} onLongPress={onLong} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={[styles.icon, overdue && { backgroundColor: palette.dangerBg }]}>
          <Feather name="calendar" size={18} color={overdue ? palette.danger : palette.brandDark} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {meeting.subject ?? titleCase(meeting.meeting_type) ?? "Meeting"}
          </Text>
          {who ? <Text variant="caption" tone="muted" numberOfLines={1}>{who}{meeting.lead_id ? " · Lead" : ""}</Text> : null}
          <Text variant="caption" tone={overdue ? "danger" : "muted"} numberOfLines={1}>
            {fmtMeetingWhen(meeting.meeting_date)} · {titleCase(meeting.meeting_mode)}
            {overdue ? " · overdue" : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: 2 }}>
            <StatusPill label={st.label} tone={st.tone} size="sm" />
            {meeting.outcome ? <StatusPill label={titleCase(meeting.outcome)} tone={OUTCOME_TONE[meeting.outcome] ?? "neutral"} size="sm" dot={false} /> : null}
            {meeting.rm_name ? <Text variant="caption" tone="faint" numberOfLines={1}>RM: {meeting.rm_name}</Text> : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

function StatTile({ icon, tone, label, value }: { icon: string; tone: string; label: string; value: number }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statHead}>
        <Feather name={icon as any} size={13} color={tone} />
        <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontSize: 20, fontWeight: fontWeight.bold as any }}>{value}</Text>
    </View>
  );
}

export default function MeetingsList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filters, setFilters] = useState<UiMeetingFilters>({ ...EMPTY_MEETING_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rowAction, setRowAction] = useState<Meeting | null>(null);
  const debounced = useDebounced(search);
  const cancel = useCancelMeeting(rowAction?.id ?? "");
  const rmOptions = useTeam().data?.rows ?? [];

  // The status chip row is a quick override on top of the sheet's status set.
  const statusCsv = status ? status : filters.status.join(",");
  const apiFilters = useMemo(() => ({
    q: debounced,
    category: filters.category.join(","),
    status: statusCsv,
    mode: filters.mode.join(","),
    type: filters.type.join(","),
    rm: filters.rm.join(","),
    meeting_from: filters.meeting_from,
    meeting_to: filters.meeting_to,
    sort: filters.sort,
  }), [debounced, filters, statusCsv]);

  const { data, isLoading, isError, error, refetch, isRefetching } = useMeetings(apiFilters);
  const meetings = data?.meetings ?? [];
  const stats = data?.stats;
  const activeCount = countMeetingFilters(filters) - filters.status.length; // status shown as chips

  const open = (id: string) => router.push(`/m/review-meetings/${id}`);
  const doCancel = (m: Meeting) => {
    setRowAction(null);
    confirmDelete({ title: "Cancel this meeting?", message: "It's marked cancelled and the reminder is cleared.", confirmLabel: "Cancel meeting" }, () => cancel.mutate());
  };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      {stats ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          <StatTile icon="clock" tone={palette.info} label="Upcoming" value={stats.upcoming ?? 0} />
          <StatTile icon="calendar" tone={palette.brand} label="This week" value={stats.this_week ?? 0} />
          <StatTile icon="check-circle" tone={palette.success} label="Completed MTD" value={stats.completed_mtd ?? 0} />
          <StatTile icon="alert-triangle" tone={palette.danger} label="Overdue" value={stats.overdue ?? 0} />
        </ScrollView>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search client, lead, RM, notes…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium as any, color: activeCount ? palette.brand : palette.ink }}>Filter & sort{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_MEETING_FILTERS, status: filters.status })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
      </View>
      <View style={styles.chips}>
        <Chip label="All" selected={status === ""} onPress={() => setStatus("")} />
        {MEETING_STATUSES.map((s) => (
          <Chip key={s} label={titleCase(s)} selected={status === s} onPress={() => setStatus(status === s ? "" : s)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Review Meetings" subtitle={isLoading ? undefined : `${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`} />
      {isLoading ? (
        <>
          <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
          <SkeletonList count={6} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={meetings}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MeetingCard meeting={item} onPress={() => open(item.id)} onLong={() => setRowAction(item)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={debounced || activeCount || status ? <SearchEmptyState query={debounced || "these filters"} /> : <EmptyState icon="calendar" title="No meetings" message="Scheduled client reviews will appear here." />}
        />
      )}
      <FAB icon="plus" onPress={() => router.push("/m/review-meetings/new" as any)} />

      <MeetingFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} rmOptions={rmOptions} />

      <BottomSheet visible={!!rowAction} onClose={() => setRowAction(null)} title={rowAction?.subject ?? "Meeting"}>
        <Button label="Open & edit meeting" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { const id = rowAction?.id; setRowAction(null); if (id) open(id); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Cancel meeting" variant="danger" full loading={cancel.isPending} icon={<Feather name="x-circle" size={15} color="#fff" />} onPress={() => rowAction && doCancel(rowAction)} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingTop: spacing.sm },
  statTile: { width: 118, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  icon: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
