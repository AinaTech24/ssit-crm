/**
 * Calendar (native) — parity with the web InteractiveCalendar. Month nav + Today
 * jump, a kind-filter legend (task / follow-up / review / SIP / campaign /
 * compliance, with counts, tap to toggle), a Month grid (day cells with colored
 * dots) with day-select → that day's agenda, and an Agenda view (day-grouped
 * list). Each row deep-links to its record. Data: GET /api/calendar?month=YYYY-MM.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Segmented } from "../../components/ui/Segmented";
import { Text } from "../../components/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "../../components/states";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { toMobileRoute } from "../command-center/api";
import { useCalendar, shiftMonth, currentMonth, kindIcon, kindColor, kindLabel, CALENDAR_KINDS, type CalendarItem } from "./api";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const todayStr = () => { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

function dayHeader(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
function timeLabel(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function CalendarScreen() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [active, setActive] = useState<Set<string>>(new Set(CALENDAR_KINDS.map((k) => k.value)));
  const [selected, setSelected] = useState<string>(todayStr());
  const { data, isLoading, isError, refetch, isRefetching } = useCalendar(month);

  const items = data?.items ?? [];
  const filtered = useMemo(() => items.filter((it) => active.has(it.kind)), [items, active]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1;
    return c;
  }, [items]);

  const [y, m] = month.split("-").map(Number);
  // When the month changes, select today if it's in view, else the 1st.
  useEffect(() => {
    const t = todayStr();
    setSelected(t.startsWith(month) ? t : isoOf(y, m, 1));
  }, [month]);

  const grid = useMemo(() => {
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: ({ iso: string; day: number } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ iso: isoOf(y, m, d), day: d });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [y, m]);

  const grouped = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    for (const it of filtered) (map[it.date] ??= []).push(it);
    return Object.keys(map).sort().map((date) => ({ date, items: map[date] }));
  }, [filtered]);

  const byDay = (iso: string) => filtered.filter((it) => it.date === iso);
  const today = todayStr();
  const toggle = (k: string) => setActive((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const goItem = (it: CalendarItem) => { const r = toMobileRoute(it.href); if (r) router.push(r as any); };

  const legend = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
      {CALENDAR_KINDS.map((k) => {
        const on = active.has(k.value);
        return (
          <Pressable key={k.value} onPress={() => toggle(k.value)} style={[styles.legendChip, { borderColor: on ? k.color : palette.line, backgroundColor: on ? k.color + "18" : palette.surface }]}>
            <View style={[styles.legendDot, { backgroundColor: on ? k.color : palette.faint }]} />
            <Text variant="caption" style={{ color: on ? palette.ink : palette.faint }}>{k.label} {counts[k.value] ?? 0}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const ItemRow = ({ it }: { it: CalendarItem }) => {
    const time = timeLabel(it.at);
    return (
      <Pressable style={styles.item} onPress={() => goItem(it)}>
        <View style={[styles.dot, { backgroundColor: kindColor(it.kind) }]}><Feather name={kindIcon(it.kind) as any} size={13} color={palette.white} /></View>
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={2}>{it.title}</Text>
          <Text variant="caption" tone="muted">{time ? `${time} · ` : ""}{kindLabel(it.kind)}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={palette.faint} />
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Calendar" onBack={() => router.back()} />
      <View style={styles.nav}>
        <Pressable onPress={() => setMonth((mm) => shiftMonth(mm, -1))} hitSlop={8} style={styles.navBtn}><Feather name="chevron-left" size={20} color={palette.ink} /></Pressable>
        <Text variant="subtitle">{data?.monthLabel ?? month}</Text>
        <Pressable onPress={() => setMonth((mm) => shiftMonth(mm, 1))} hitSlop={8} style={styles.navBtn}><Feather name="chevron-right" size={20} color={palette.ink} /></Pressable>
        <Pressable onPress={() => setMonth(currentMonth())} hitSlop={8} style={styles.todayBtn}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Today</Text></Pressable>
      </View>

      {isLoading ? (
        <LoadingState label="Loading calendar…" />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
          showsVerticalScrollIndicator={false}
        >
          {legend}
          <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
            <Segmented options={[{ key: "month", label: "Month" }, { key: "agenda", label: "Agenda" }]} value={view} onChange={(v) => setView(v as any)} />
          </View>

          {view === "month" ? (
            <>
              <View style={styles.weekRow}>
                {WEEKDAYS.map((w, i) => <Text key={i} variant="caption" tone="faint" style={styles.weekCell}>{w}</Text>)}
              </View>
              <View style={styles.grid}>
                {grid.map((c, i) => {
                  if (!c) return <View key={i} style={styles.cell} />;
                  const dayItems = byDay(c.iso);
                  const kinds = Array.from(new Set(dayItems.map((it) => it.kind))).slice(0, 4);
                  const isToday = c.iso === today;
                  const isSel = c.iso === selected;
                  return (
                    <Pressable key={i} style={[styles.cell, isSel && styles.cellSel]} onPress={() => setSelected(c.iso)}>
                      <View style={[styles.dayNum, isToday && styles.dayToday]}>
                        <Text variant="caption" style={{ color: isToday ? palette.white : palette.ink, fontWeight: (isToday ? fontWeight.bold : fontWeight.regular) as any }}>{c.day}</Text>
                      </View>
                      <View style={styles.dotsRow}>
                        {kinds.map((k) => <View key={k} style={[styles.miniDot, { backgroundColor: kindColor(k) }]} />)}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Selected day's agenda */}
              <View style={{ marginTop: spacing.lg }}>
                <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>{dayHeader(selected).toUpperCase()}{selected === today ? " · TODAY" : ""}</Text>
                {byDay(selected).length === 0 ? (
                  <Text variant="caption" tone="muted">Nothing scheduled.</Text>
                ) : byDay(selected).map((it) => <ItemRow key={it.id} it={it} />)}
              </View>
            </>
          ) : grouped.length === 0 ? (
            <EmptyState icon="calendar" title="Nothing scheduled" message={`No events in ${data?.monthLabel ?? "this month"}.`} />
          ) : (
            grouped.map((g) => (
              <View key={g.date} style={{ marginBottom: spacing.lg }}>
                <Text style={[styles.dayText, g.date === today && { color: palette.brand }]}>{dayHeader(g.date)}{g.date === today ? " · Today" : ""}</Text>
                {g.items.map((it) => <ItemRow key={it.id} it={it} />)}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  nav: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: palette.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  navBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  todayBtn: { marginLeft: "auto", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: palette.brandLight },
  legend: { gap: spacing.sm, paddingVertical: 2 },
  legendChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  weekRow: { flexDirection: "row" },
  weekCell: { flex: 1, textAlign: "center", paddingBottom: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, overflow: "hidden" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.lineSoft },
  cellSel: { backgroundColor: palette.brandLight },
  dayNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayToday: { backgroundColor: palette.brand },
  dotsRow: { flexDirection: "row", gap: 2, height: 6 },
  miniDot: { width: 5, height: 5, borderRadius: 2.5 },
  dayText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold as any, color: palette.muted, marginBottom: spacing.sm },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
