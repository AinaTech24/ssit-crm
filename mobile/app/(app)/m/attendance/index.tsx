/**
 * Attendance — clock in / out of the work day, with a live running timer, a
 * GPS stamp (a field team never sees an office, so "where" is the honest part of
 * "when"), a month summary and recent history. Managers get a Team tab, since
 * the list endpoint returns the whole firm.
 */

import React from "react";
import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Chip } from "../../../../src/components/ui/Chip";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import {
  useAttendance, useClock, findDay, myRows, isoDay, durationLabel, timeLabel,
  totalMinutes, STATUS_TONE, type AttendanceRow,
} from "../../../../src/features/attendance/api";
import { getCheckinLocation } from "../../../../src/features/activities/checkin";
import { useMe } from "../../../../src/api/me";
import { toast } from "../../../../src/lib/toast";
import { fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

const MANAGER_ROLES = ["owner", "branch_head"];

export default function Attendance() {
  const me = useMe();
  const { data, isLoading, isRefetching, refetch } = useAttendance();
  const clock = useClock();
  const [tab, setTab] = React.useState<"me" | "team">("me");
  const [busy, setBusy] = React.useState(false);

  // Re-render every 30s so the running timer stays honest.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const userId = me.data?.user.id;
  const isManager = (me.data?.user.roles ?? []).some((r) => MANAGER_ROLES.includes(r));
  const today = isoDay(new Date());
  const todayRow = findDay(data, userId, today);
  const mine = myRows(data, userId);

  const clockedIn = !!todayRow?.clock_in_at && !todayRow?.clock_out_at;
  const doneForDay = !!todayRow?.clock_in_at && !!todayRow?.clock_out_at;

  const punch = async (action: "in" | "out") => {
    setBusy(true);
    // Location is a nicety — never block the punch on it.
    const loc = await getCheckinLocation().catch(() => null);
    clock.mutate(
      { action, ...(loc ? { lat: loc.lat, lng: loc.lng } : {}) },
      {
        onSuccess: (r) => {
          if (r?.error) return toast.error(r.error);
          toast.success(action === "in" ? "Clocked in — have a good day" : "Clocked out");
        },
        onError: (e: any) => toast.error(e?.body?.error || "Couldn't record that"),
        onSettled: () => setBusy(false),
      }
    );
  };

  // This month, from my rows.
  const monthPrefix = today.slice(0, 7);
  const monthRows = mine.filter((r) => String(r.attendance_date).slice(0, 7) === monthPrefix);
  const daysPresent = monthRows.filter((r) => r.status === "present").length;
  const monthMins = totalMinutes(monthRows);

  // Team today (managers).
  const teamToday = (data ?? []).filter((r) => String(r.attendance_date).slice(0, 10) === today);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Attendance" subtitle={fmtDate(today)} />
      <Screen scroll padded onRefresh={refetch} refreshing={isRefetching} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {isLoading || me.isLoading ? (
          <Card><Skeleton width="50%" height={18} /><Skeleton width="100%" height={56} style={{ marginTop: 12 }} /></Card>
        ) : (
          <>
            {/* Today — the clock */}
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text variant="caption" tone="faint">TODAY</Text>
                {todayRow?.status ? <StatusPill label={titleCase(todayRow.status)} tone={STATUS_TONE[todayRow.status] ?? "neutral"} size="sm" /> : null}
              </View>

              <Text style={styles.timer}>{clockedIn || doneForDay ? durationLabel(todayRow) : "Not started"}</Text>
              <Text variant="caption" tone="muted">
                {clockedIn ? "Working since " + timeLabel(todayRow?.clock_in_at) : doneForDay ? `${timeLabel(todayRow?.clock_in_at)} → ${timeLabel(todayRow?.clock_out_at)}` : "Clock in to start your day"}
              </Text>

              {/* The button */}
              {doneForDay ? (
                <View style={[styles.doneBox, { backgroundColor: toneColors("success").bg }]}>
                  <Feather name="check-circle" size={16} color={toneColors("success").fg} />
                  <Text variant="body" style={{ color: toneColors("success").fg, fontWeight: fontWeight.semibold as any }}>Day complete — {durationLabel(todayRow)}</Text>
                </View>
              ) : (
                <Pressable
                  style={[styles.punchBtn, { backgroundColor: clockedIn ? toneColors("danger").fg : toneColors("success").fg }, busy && { opacity: 0.6 }]}
                  onPress={() => punch(clockedIn ? "out" : "in")}
                  disabled={busy || clock.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={clockedIn ? "Clock out" : "Clock in"}
                >
                  {busy || clock.isPending ? (
                    <ActivityIndicator color={palette.white} />
                  ) : (
                    <>
                      <Feather name={clockedIn ? "log-out" : "log-in"} size={18} color={palette.white} />
                      <Text style={styles.punchTxt}>{clockedIn ? "Clock out" : "Clock in"}</Text>
                    </>
                  )}
                </Pressable>
              )}

              {todayRow?.clock_in_lat ? (
                <View style={styles.geoRow}>
                  <Feather name="map-pin" size={12} color={palette.muted} />
                  <Text variant="caption" tone="muted">Location recorded at clock-in</Text>
                </View>
              ) : null}
            </Card>

            {/* This month */}
            <SectionLabel icon="calendar" text={`THIS MONTH`} />
            <Card flat>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Metric label="Days present" value={String(daysPresent)} />
                <View style={styles.vline} />
                <Metric label="Hours logged" value={monthMins > 0 ? `${Math.floor(monthMins / 60)}h` : "—"} />
                <View style={styles.vline} />
                <Metric label="Avg / day" value={daysPresent > 0 && monthMins > 0 ? `${Math.round(monthMins / daysPresent / 60 * 10) / 10}h` : "—"} />
              </View>
            </Card>

            {/* Tabs (team only for managers) */}
            {isManager ? (
              <View style={styles.chips}>
                <Chip label="My history" selected={tab === "me"} onPress={() => setTab("me")} />
                <Chip label={`Team today (${teamToday.length})`} selected={tab === "team"} onPress={() => setTab("team")} />
              </View>
            ) : null}

            {tab === "team" && isManager ? (
              <>
                <SectionLabel icon="users" text="WHO'S IN TODAY" />
                <Card flat style={{ padding: 0, overflow: "hidden" }}>
                  {teamToday.length === 0 ? (
                    <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">Nobody has clocked in yet today.</Text></View>
                  ) : (
                    teamToday.map((r, i) => (
                      <View key={r.id} style={[styles.row, i < teamToday.length - 1 && styles.divider]}>
                        <View style={{ flex: 1 }}>
                          <Text variant="body" numberOfLines={1}>{r.employee_name ?? "—"}</Text>
                          <Text variant="caption" tone="muted">{timeLabel(r.clock_in_at)}{r.clock_out_at ? ` → ${timeLabel(r.clock_out_at)}` : " · still in"}</Text>
                        </View>
                        <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any }}>{durationLabel(r)}</Text>
                      </View>
                    ))
                  )}
                </Card>
              </>
            ) : (
              <>
                <SectionLabel icon="clock" text="RECENT DAYS" />
                <Card flat style={{ padding: 0, overflow: "hidden" }}>
                  {mine.length === 0 ? (
                    <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">No attendance recorded yet — clock in above.</Text></View>
                  ) : (
                    mine.slice(0, 20).map((r, i, arr) => <DayRow key={r.id} r={r} last={i === arr.length - 1} />)
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}

function DayRow({ r, last }: { r: AttendanceRow; last: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{fmtDate(r.attendance_date)}</Text>
        <Text variant="caption" tone="muted">
          {r.clock_in_at ? `${timeLabel(r.clock_in_at)}${r.clock_out_at ? ` → ${timeLabel(r.clock_out_at)}` : " · no clock-out"}` : "—"}
        </Text>
      </View>
      {r.status ? <StatusPill label={titleCase(r.status)} tone={STATUS_TONE[r.status] ?? "neutral"} size="sm" dot={false} /> : null}
      <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any, minWidth: 52, textAlign: "right" }}>{durationLabel(r)}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 18, fontWeight: fontWeight.bold as any }}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function SectionLabel({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.sm }}><Feather name={icon} size={13} color={palette.muted} /><Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  timer: { fontSize: 34, fontWeight: fontWeight.bold as any, letterSpacing: -0.6, marginTop: 6 },
  punchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.lg },
  punchTxt: { color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 16 },
  doneBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.lg },
  geoRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.md },
  vline: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: palette.line },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
