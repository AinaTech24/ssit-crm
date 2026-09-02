/**
 * Home — the field salesperson's daily cockpit. Greeting → quick actions → book
 * at a glance → WEEK STRIP (tap any of the next 14 days to see its schedule) →
 * THE DAY'S PLAN (meetings, follow-ups, tasks — each actionable inline: call /
 * WhatsApp / complete / open) → THIS WEEK touchpoints (client birthdays &
 * investment anniversaries with a one-tap WhatsApp wish) → recently viewed.
 * Data: /api/me + /api/dashboard/home + /api/dashboard/my-day?date=.
 */

import React from "react";
import { View, Pressable, Linking, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { useMe } from "../../../../src/api/me";
import { api } from "../../../../src/api/client";
import { useDashboardHome, useMyDay, useMyPerformance, isoDay, type Kpi, type DayMeeting, type DayFollowup, type DayTask, type Touchpoint, type AgendaDay, type MyPerformance, type PerfKpi } from "../../../../src/features/dashboard/api";
import { useCommandCenter, toneColor, featherIcon, toMobileRoute, type CommandGroup, type CommandItem } from "../../../../src/features/command-center/api";
import { useRecentlyViewed } from "../../../../src/state/recentlyViewed";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { useAttendance, findDay, isoDay as attIsoDay } from "../../../../src/features/attendance/api";
import { toast } from "../../../../src/lib/toast";
import { inr, initials, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const LICENSE_TONE: Record<string, Tone> = {
  active: "success", trial: "info", past_due: "warning", suspended: "danger", expired: "danger", pending: "warning", cancelled: "danger", no_subscription: "neutral",
};
const firstName = (n?: string | null) => (n ?? "").trim().split(" ")[0] || "there";
/** Opens WhatsApp and records the touch on the client's timeline. */
const openWa = (
  phone: string | null | undefined,
  text: string,
  subject?: { type: "investor" | "lead"; id: string | null; name?: string | null; purpose?: string }
) => openWhatsApp({ phone, text, subjectType: subject?.type, subjectId: subject?.id, name: subject?.name, purpose: subject?.purpose });
function timeLabel(at?: string | null): string { if (!at) return ""; const d = new Date(at); return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); }
const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral" };

// ── Week strip helpers ──
/** "2026-07-21" → a local Date (never `new Date(str)`, which parses as UTC). */
const fromIsoDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Today" / "Tomorrow" / "Tue, 21 Jul" — the plan section's heading. */
function dayHeading(iso: string, today: string): string {
  const d = fromIsoDay(iso);
  const diff = Math.round((d.getTime() - fromIsoDay(today).getTime()) / 86400000);
  if (diff === 0) return "TODAY'S PLAN";
  if (diff === 1) return "TOMORROW'S PLAN";
  return `${WEEKDAYS[d.getDay()].toUpperCase()}, ${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" }).toUpperCase()}`;
}
const DOT_COLORS = { meetings: palette.brand, followups: palette.warning, tasks: palette.violet };

/** Command-queue groups already shown by the day's plan / touchpoints — excluded
 *  from "Needs you now" so the same item never appears twice on Home. */
const PLAN_COVERS = new Set(["tasks_overdue", "lead_followups", "meetings_today", "birthdays_today", "birthdays"]);

export default function Home() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const dash = useDashboardHome();
  // Today is fixed for the life of the screen; the strip selects a day within it.
  const today = React.useMemo(() => isoDay(new Date()), []);
  const [selected, setSelected] = React.useState(today);
  const day = useMyDay(selected);
  const perf = useMyPerformance();
  const cc = useCommandCenter();
  const attendance = useAttendance();
  const todayAttendance = findDay(attendance.data, me.data?.user.id, attIsoDay(new Date()));
  const isToday = selected === today;

  // "Act now" = the money-at-risk band (bounced SIPs, rejected mandates,
  // redemption risk, SLA breaches) — an MFD's most expensive daily miss.
  // Skip the groups the day's plan already renders, or Home lists them twice:
  // tasks_overdue IS my-day's overdue-task sweep, and lead_followups its follow-ups.
  const urgent = (cc.data?.groups ?? []).filter(
    (g) => g.severity === "now" && g.count > 0 && !PLAN_COVERS.has(g.key)
  );
  const atRisk = urgent.reduce((sum, g) => sum + g.items.reduce((s, i) => s + (i.amount ?? 0), 0), 0);

  const complete = useMutation({
    mutationFn: (id: string) => api.patch(`/api/tasks/${id}`, { status: "completed" }),
    onSuccess: () => { toast.success("Task completed"); qc.invalidateQueries({ queryKey: ["my-day"] }); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["dashboard-home"] }); },
  });

  const refetch = () => { me.refetch(); dash.refetch(); day.refetch(); perf.refetch(); cc.refetch(); };

  const kpis = dash.data?.kpis ?? [];
  const byKey = (k: string): Kpi | undefined => kpis.find((x) => x.key === k);
  const fmt = (k?: Kpi): string => (k ? (k.format === "inr" ? inr(k.value) : k.value.toLocaleString("en-IN")) : "—");
  const attention = (dash.data?.worklist ?? []).filter((w) => w.count > 0);
  const recent = useRecentlyViewed((s) => s.items);

  const md = day.data;
  // "Today" also sweeps in the whole overdue backlog (by design — see my-day's
  // API docstring), which can be dozens of tasks and floods this card. Home
  // only wants what's actually due ON this day; overdue items already surface
  // via "Needs you now" / the Tasks tab, so drop them here to keep this short.
  // (Non-today days are already day-scoped server-side — nothing to filter.)
  const todaysTasks = React.useMemo(() => (isToday ? (md?.tasks ?? []).filter((t) => !t.overdue) : md?.tasks ?? []), [md, isToday]);
  const planEmpty = md && md.meetings.length === 0 && md.followups.length === 0 && todaysTasks.length === 0;

  return (
    <Screen scroll padded onRefresh={refetch} refreshing={me.isRefetching || dash.isRefetching || day.isRefetching} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
      {/* Greeting */}
      <Animated.View entering={FadeInUp.duration(300)}>
        {me.isLoading ? (
          <View style={{ gap: spacing.sm }}><Skeleton width="55%" height={26} /><Skeleton width="35%" height={16} /></View>
        ) : (
          <>
            <Text variant="title">Hi, {firstName(me.data?.user.name)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}>
              <Text variant="body" tone="muted">{me.data?.user.roleLabel}</Text>
              {me.data?.license?.status ? <StatusPill label={me.data.license.status.replace("_", " ")} tone={LICENSE_TONE[me.data.license.status] ?? "neutral"} size="sm" /> : null}
            </View>
          </>
        )}
      </Animated.View>

      {/* Plan-my-day banner — the morning ritual, one tap from Home */}
      <Pressable style={styles.planBanner} onPress={() => router.push("/m/daily" as any)}>
        <View style={styles.planIcon}><Feather name="sun" size={18} color={palette.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }}>Plan your day</Text>
          <Text variant="caption" tone="muted">Set today's focus & reflect</Text>
        </View>
        <Feather name="chevron-right" size={18} color={palette.faint} />
      </Pressable>

      {/* Clock-in nudge — only while the day is still unstarted, so it disappears
          the moment it stops being useful rather than nagging all day. */}
      {attendance.data && !todayAttendance?.clock_in_at ? (
        <Pressable style={styles.clockBanner} onPress={() => router.push("/m/attendance" as any)}>
          <View style={styles.clockIcon}><Feather name="log-in" size={18} color={toneColors("success").fg} /></View>
          <View style={{ flex: 1 }}>
            <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }}>You haven't clocked in</Text>
            <Text variant="caption" tone="muted">Start your day</Text>
          </View>
          <Feather name="chevron-right" size={18} color={palette.faint} />
        </Pressable>
      ) : null}

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <QuickAction icon="phone" label="Log call" onPress={() => router.push("/m/activities/new" as any)} />
        <QuickAction icon="check-square" label="New task" onPress={() => router.push("/m/tasks/new" as any)} />
        <QuickAction icon="trending-up" label="New lead" onPress={() => router.push("/m/leads/new" as any)} />
        <QuickAction icon="video" label="Meeting" onPress={() => router.push("/m/review-meetings/new" as any)} />
      </View>

      {/* Hero — book at a glance */}
      {dash.isLoading ? (
        <Card style={{ marginTop: spacing.xl }}><Skeleton width="40%" height={14} /><Skeleton width="60%" height={32} style={{ marginTop: 10 }} /></Card>
      ) : (
        <Card style={{ marginTop: spacing.xl }}>
          <Text variant="caption" tone="faint">{(byKey("aum")?.label ?? "TOTAL AUM").toUpperCase()}</Text>
          <Text style={styles.hero}>{fmt(byKey("aum"))}</Text>
          <View style={styles.statRow}>
            <Stat label="Clients" value={fmt(byKey("clients"))} />
            <View style={styles.vline} />
            <Stat label="Monthly SIP" value={fmt(byKey("sipBook"))} />
            <View style={styles.vline} />
            <Stat label="Open Leads" value={fmt(byKey("leadsOpen"))} />
          </View>
        </Card>
      )}

      {/* Attention chips (overdue / reviews due — counts that aren't in today's plan) */}
      {attention.length > 0 ? (
        <View style={styles.chipsRow}>
          {attention.map((w) => (
            <Pressable key={w.key} style={[styles.attnChip, { backgroundColor: toneColors(w.tone).bg }]} onPress={() => router.push(w.href as any)}>
              <Feather name={w.icon as any} size={12} color={toneColors(w.tone).fg} />
              <Text variant="caption" style={{ color: toneColors(w.tone).fg, fontWeight: fontWeight.semibold as any }}>{w.count} {w.label.toLowerCase()}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* NEEDS YOU NOW — bounced SIPs, rejected mandates, redemption risk, SLA
          breaches. Money leaves the book when these wait, so they sit above the
          day's plan. Each row calls/WhatsApps the client without a detour. */}
      {urgent.length > 0 ? (
        <>
          <View style={styles.stripHead}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Feather name="alert-triangle" size={13} color={toneColors("danger").fg} />
              <Text variant="caption" style={{ color: toneColors("danger").fg, letterSpacing: 0.6, fontWeight: fontWeight.semibold as any }}>NEEDS YOU NOW</Text>
            </View>
            {atRisk > 0 ? <Text variant="caption" tone="muted">{inr(atRisk)} at risk</Text> : null}
          </View>
          {urgent.map((g) => <UrgentGroup key={g.key} g={g} router={router} />)}
        </>
      ) : null}

      {/* WEEK STRIP — what's scheduled over the next 14 days; tap a day for its plan */}
      <View style={styles.stripHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Feather name="calendar" size={13} color={palette.muted} />
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>MY SCHEDULE</Text>
        </View>
        <Pressable onPress={() => router.push("/m/calendar" as any)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Full calendar</Text>
          <Feather name="chevron-right" size={13} color={palette.brand} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripBleed} contentContainerStyle={styles.strip}>
        {(day.data?.agenda ?? []).map((a) => (
          <DayChip key={a.date} a={a} selected={a.date === selected} today={a.date === today} onPress={() => setSelected(a.date)} />
        ))}
      </ScrollView>

      {/* THE DAY'S PLAN */}
      <SectionLabel icon={isToday ? "sun" : "calendar"} text={dayHeading(selected, today)} />
      {day.isLoading ? (
        <Card><Skeleton width="70%" height={16} /><Skeleton width="50%" height={14} style={{ marginTop: 10 }} /></Card>
      ) : planEmpty ? (
        <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={[styles.roundIcon, { backgroundColor: toneColors(isToday ? "success" : "neutral").bg }]}><Feather name={isToday ? "check" : "calendar"} size={18} color={toneColors(isToday ? "success" : "neutral").fg} /></View>
          <Text variant="body" style={{ flex: 1, color: palette.ink }}>{isToday ? "You're clear for today — nice work." : "Nothing scheduled for this day."}</Text>
        </Card>
      ) : (
        <>
          {(md?.meetings.length ?? 0) > 0 ? (
            <PlanGroup title={`Meetings (${md!.meetings.length})`}>
              {md!.meetings.map((m) => <MeetingRow key={m.id} m={m} onOpen={() => router.push(`/m/review-meetings/${m.id}` as any)} />)}
            </PlanGroup>
          ) : null}
          {(md?.followups.length ?? 0) > 0 ? (
            <PlanGroup title={`Follow-ups due (${md!.followups.length})`}>
              {md!.followups.map((f) => <FollowupRow key={f.id} f={f} onOpen={() => router.push(`/m/leads/${f.id}` as any)} />)}
            </PlanGroup>
          ) : null}
          {todaysTasks.length > 0 ? (
            <PlanGroup title={`Tasks due today (${todaysTasks.length})`}>
              <ScrollView style={styles.tasksScroll} nestedScrollEnabled showsVerticalScrollIndicator={todaysTasks.length > 4}>
                {todaysTasks.map((t) => <TaskRow key={t.id} t={t} busy={complete.isPending} onDone={() => complete.mutate(t.id)} onOpen={() => router.push(`/m/tasks/${t.id}` as any)} />)}
              </ScrollView>
            </PlanGroup>
          ) : null}
        </>
      )}

      {/* MY NUMBERS — the "how am I doing" half of the day. Today's effort is the
          fast feedback; the month bars are what the RM is measured on. */}
      {perf.data?.me ? <MyNumbers p={perf.data} /> : null}

      {/* THIS WEEK — touchpoints (always relative to today, so only on the today view) */}
      {isToday && (md?.touchpoints.length ?? 0) > 0 ? (
        <>
          <SectionLabel icon="gift" text="THIS WEEK · WISH YOUR CLIENTS" />
          <Card flat style={{ padding: 0, overflow: "hidden" }}>
            {md!.touchpoints.map((t, i) => (
              <TouchpointRow key={`${t.kind}-${t.id}`} t={t} last={i === md!.touchpoints.length - 1} onOpen={() => router.push(`/m/investors/${t.id}` as any)} />
            ))}
          </Card>
        </>
      ) : null}

      {/* Recently viewed */}
      {recent.length > 0 ? (
        <>
          <SectionLabel icon="clock" text="RECENTLY VIEWED" />
          <Card flat style={{ padding: 0, overflow: "hidden" }}>
            {recent.map((r, i) => (
              <Pressable key={`${r.type}-${r.id}`} style={[styles.row, i < recent.length - 1 && styles.divider]} onPress={() => router.push(`/m/${r.type === "investor" ? "investors" : "leads"}/${r.id}` as any)}>
                <View style={[styles.avatar, { backgroundColor: palette.violet }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{initials(r.name)}</Text></View>
                <Text variant="body" style={{ flex: 1, color: palette.ink }} numberOfLines={1}>{r.name}</Text>
                <Text variant="caption" tone="faint">{r.type === "investor" ? "Client" : "Lead"}</Text>
                <Feather name="chevron-right" size={16} color={palette.faint} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ── Needs you now ──
/** One urgent queue group (e.g. "SIP bounces"), with its top items inline. */
function UrgentGroup({ g, router }: { g: CommandGroup; router: ReturnType<typeof useRouter> }) {
  const color = toneColor(g.tone);
  const shown = g.items.slice(0, 3);
  return (
    <Card flat style={{ padding: 0, overflow: "hidden", marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: color }}>
      <View style={styles.urgentHead}>
        <Feather name={featherIcon(g.icon) as any} size={14} color={color} />
        <Text variant="label" style={{ flex: 1, color: palette.ink }}>{g.label}</Text>
        <View style={[styles.countPill, { backgroundColor: color }]}><Text variant="caption" style={{ color: palette.white, fontWeight: fontWeight.bold as any }}>{g.count}</Text></View>
      </View>
      {shown.map((it) => <UrgentRow key={it.itemKey} it={it} router={router} />)}
      {g.count > shown.length && g.href ? (
        <Pressable style={styles.moreRow} onPress={() => { const r = toMobileRoute(g.href!); if (r) router.push(r as any); }}>
          <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>See all {g.count}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function UrgentRow({ it, router }: { it: CommandItem; router: ReturnType<typeof useRouter> }) {
  const open = () => { const r = toMobileRoute(it.href); if (r) router.push(r as any); };
  return (
    <Pressable style={styles.planRow} onPress={open}>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{it.title}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {it.detail ?? it.client?.name ?? ""}{it.ageDays != null && it.ageDays > 0 ? ` · ${it.ageDays}d old` : ""}
        </Text>
      </View>
      {it.amount ? <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any }}>{inr(it.amount)}</Text> : null}
      <RowActions
        phone={it.phone}
        onCall={() => startCall({ subjectType: "investor", subjectId: it.client?.id ?? "", name: it.client?.name ?? it.title, phone: it.phone ?? "" })}
        subject={{ type: "investor", id: it.client?.id ?? null, name: it.client?.name, purpose: "Needs attention" }}
      />
    </Pressable>
  );
}

// ── My numbers ──
const BAND_TONE: Record<string, Tone> = { green: "success", amber: "warning", red: "danger" };
/** Only the metrics a salesperson moves — the ops/derived ones are noise here. */
const MY_METRICS = ["mf_business", "insurance_business", "other_business", "new_clients", "converted", "meetings", "activities"];
const perfValue = (k: PerfKpi) => (k.unit === "inr" ? inr(k.actual) : k.unit === "pct" ? `${Math.round(k.actual)}%` : String(k.actual));

function MyNumbers({ p }: { p: MyPerformance }) {
  const me = p.me!;
  const tone = BAND_TONE[me.band] ?? "neutral";
  // Show targeted metrics first; drop untargeted zero rows so the card stays honest and short.
  const kpis = MY_METRICS.map((k) => me.kpis.find((x) => x.key === k)).filter(Boolean) as PerfKpi[];
  const shown = kpis.filter((k) => (k.target ?? 0) > 0 || k.actual > 0);
  const monthLabel = fromIsoDay(p.from).toLocaleString("en-IN", { month: "long" });
  return (
    <>
      <SectionLabel icon="target" text="MY NUMBERS" />
      <Card>
        {/* Today — the effort an RM controls directly */}
        <View style={styles.statRow2}>
          <Stat label="Calls today" value={String(p.today.calls)} />
          <View style={styles.vline} />
          <Stat label="Meetings" value={String(p.today.meetings)} />
          <View style={styles.vline} />
          <Stat label="Tasks done" value={String(p.today.tasks)} />
        </View>

        {/* Month — what they're measured on */}
        <View style={styles.perfHead}>
          <Text variant="caption" tone="faint">{monthLabel.toUpperCase()} · KRA SCORE</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <StatusPill label={`${me.kraScore}/100`} tone={tone} size="sm" />
            {p.rank && p.outOf && p.outOf > 1 ? <Text variant="caption" tone="muted">#{p.rank} of {p.outOf}</Text> : null}
          </View>
        </View>
        {shown.length === 0 ? (
          <Text variant="caption" tone="muted">No activity booked this month yet.</Text>
        ) : (
          shown.map((k) => <PerfRow key={k.key} k={k} />)
        )}
        {shown.every((k) => !k.target) ? (
          <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>No targets set — ask your admin to set them for progress bars.</Text>
        ) : null}
      </Card>
    </>
  );
}

function PerfRow({ k }: { k: PerfKpi }) {
  const hasTarget = (k.target ?? 0) > 0;
  const pct = hasTarget ? Math.min(100, Math.round((k.actual / k.target!) * 100)) : 0;
  const tone: Tone = !hasTarget ? "neutral" : pct >= 75 ? "success" : pct >= 50 ? "warning" : "danger";
  return (
    <View style={{ marginTop: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{k.label}</Text>
        <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold as any }}>
          {perfValue(k)}{hasTarget ? <Text variant="caption" tone="faint"> / {k.unit === "inr" ? inr(k.target!) : k.target}</Text> : null}
        </Text>
      </View>
      {hasTarget ? (
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%`, backgroundColor: toneColors(tone).fg }]} /></View>
      ) : null}
    </View>
  );
}

// ── Week strip ──
/** One day: weekday, date, and a dot per kind of thing scheduled (meeting /
 *  follow-up / task). Selected day is filled; today keeps a ring when unselected. */
function DayChip({ a, selected, today, onPress }: { a: AgendaDay; selected: boolean; today: boolean; onPress: () => void }) {
  const d = fromIsoDay(a.date);
  const kinds = (["meetings", "followups", "tasks"] as const).filter((k) => a[k] > 0);
  const total = a.meetings + a.followups + a.tasks;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${WEEKDAYS[d.getDay()]} ${d.getDate()}, ${total} item${total === 1 ? "" : "s"}`}
      style={[styles.dayChip, selected && styles.dayChipOn, !selected && today && styles.dayChipToday]}
    >
      <Text variant="caption" style={{ color: selected ? "rgba(255,255,255,0.75)" : palette.faint }}>{WEEKDAYS[d.getDay()]}</Text>
      <Text style={[styles.dayNum, { color: selected ? palette.white : palette.ink }]}>{d.getDate()}</Text>
      <View style={styles.dotRow}>
        {kinds.length > 0
          ? kinds.map((k) => <View key={k} style={[styles.dot, { backgroundColor: selected ? palette.white : DOT_COLORS[k] }]} />)
          : <View style={[styles.dot, { backgroundColor: "transparent" }]} />}
      </View>
    </Pressable>
  );
}

// ── Rows ──
function MeetingRow({ m, onOpen }: { m: DayMeeting; onOpen: () => void }) {
  const t = timeLabel(m.at);
  const subjectType = m.investor_id ? "investor" : "lead";
  const subjectId = m.investor_id ?? m.lead_id ?? "";
  return (
    <Pressable style={styles.planRow} onPress={onOpen}>
      <View style={[styles.roundIcon, { backgroundColor: palette.brandLight }]}><Feather name="video" size={16} color={palette.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{m.subject || titleCase(m.meeting_type) || "Meeting"}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>{t ? `${t} · ` : ""}{m.client_name ?? "—"}{m.meeting_mode ? ` · ${titleCase(m.meeting_mode)}` : ""}</Text>
      </View>
      <RowActions phone={m.phone} onCall={() => startCall({ subjectType, subjectId, name: m.client_name ?? "Client", phone: m.phone ?? "" })} subject={{ type: subjectType, id: subjectId, name: m.client_name, purpose: "Meeting" }} />
    </Pressable>
  );
}

function FollowupRow({ f, onOpen }: { f: DayFollowup; onOpen: () => void }) {
  return (
    <Pressable style={styles.planRow} onPress={onOpen}>
      <View style={[styles.roundIcon, { backgroundColor: f.overdue ? toneColors("danger").bg : palette.warningBg }]}><Feather name="corner-up-right" size={16} color={f.overdue ? toneColors("danger").fg : palette.warning} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{f.name ?? "Lead"}</Text>
        <Text variant="caption" numberOfLines={1} style={f.overdue ? { color: toneColors("danger").fg } : undefined} tone={f.overdue ? undefined : "muted"}>
          {f.overdue ? "Overdue" : "Follow-up due"}{f.stage ? ` · ${titleCase(f.stage)}` : ""}
        </Text>
      </View>
      <RowActions phone={f.phone} onCall={() => startCall({ subjectType: "lead", subjectId: f.id, name: f.name ?? "Lead", phone: f.phone ?? "" })} subject={{ type: "lead", id: f.id, name: f.name, purpose: "Follow-up" }} />
    </Pressable>
  );
}

function TaskRow({ t, busy, onDone, onOpen }: { t: DayTask; busy: boolean; onDone: () => void; onOpen: () => void }) {
  return (
    <View style={styles.planRow}>
      <Pressable onPress={onDone} disabled={busy} hitSlop={8}><Feather name="circle" size={22} color={palette.faint} /></Pressable>
      <Pressable style={{ flex: 1 }} onPress={onOpen}>
        <Text variant="body" numberOfLines={1}>{t.title ?? "Task"}</Text>
        <Text variant="caption" numberOfLines={1} style={t.overdue ? { color: toneColors("danger").fg } : undefined} tone={t.overdue ? undefined : "muted"}>
          {t.overdue ? "Overdue" : timeLabel(t.due_at) || "Due"}
        </Text>
      </Pressable>
      {t.priority ? <StatusPill label={titleCase(t.priority)} tone={PRIORITY_TONE[t.priority] ?? "neutral"} size="sm" dot={false} /> : null}
    </View>
  );
}

function TouchpointRow({ t, last, onOpen }: { t: Touchpoint; last: boolean; onOpen: () => void }) {
  const when = t.days_until === 0 ? "Today" : t.days_until === 1 ? "Tomorrow" : `in ${t.days_until}d`;
  const isBday = t.kind === "birthday";
  const label = isBday ? "Birthday" : `${t.years ?? ""}yr anniversary`;
  const msg = isBday
    ? `Dear ${firstName(t.name)}, wishing you a very happy birthday! 🎉 May the year ahead bring you great health, happiness and prosperity.`
    : `Dear ${firstName(t.name)}, congratulations on ${t.years ?? ""} ${t.years === 1 ? "year" : "years"} of your investment journey with us! 🎊 Thank you for your continued trust.`;
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={[styles.roundIcon, { backgroundColor: isBday ? "#FCE7F3" : palette.successBg }]}><Feather name={isBday ? "gift" : "award"} size={16} color={isBday ? "#DB2777" : palette.success} /></View>
      <Pressable style={{ flex: 1 }} onPress={onOpen}>
        <Text variant="body" numberOfLines={1}>{t.name ?? "Client"}</Text>
        <Text variant="caption" tone="muted">{label} · {when}</Text>
      </Pressable>
      <Pressable onPress={() => openWa(t.whatsapp_phone || t.phone, msg, { type: "investor", id: t.id, name: t.name, purpose: isBday ? "Birthday wish" : "Anniversary wish" })} style={styles.wishBtn}>
        <Feather name="message-circle" size={14} color={palette.white} />
        <Text variant="caption" style={{ color: palette.white, fontWeight: fontWeight.semibold as any }}>Wish</Text>
      </Pressable>
    </View>
  );
}

function RowActions({ phone, onCall, subject }: { phone?: string | null; onCall: () => void; subject?: { type: "investor" | "lead"; id: string | null; name?: string | null; purpose?: string } }) {
  if (!phone) return <Feather name="chevron-right" size={16} color={palette.faint} />;
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <Pressable onPress={onCall} hitSlop={6} style={styles.iconBtn}><Feather name="phone" size={15} color={palette.brand} /></Pressable>
      <Pressable onPress={() => openWa(phone, "", subject)} hitSlop={6} style={styles.iconBtn}><Feather name="message-circle" size={15} color={palette.success} /></Pressable>
    </View>
  );
}

// ── Small helpers ──
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 16, fontWeight: fontWeight.bold as any }} numberOfLines={1}>{value}</Text><Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text></View>;
}
function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.quickAction}><View style={styles.quickIcon}><Feather name={icon as any} size={18} color={palette.brand} /></View><Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text></Pressable>;
}
function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.sm }}><Feather name={icon as any} size={13} color={palette.muted} /><Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>{text}</Text></View>;
}
function PlanGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card flat style={{ padding: 0, overflow: "hidden", marginBottom: spacing.md }}>
      <Text variant="label" tone="muted" style={styles.groupTitle}>{title}</Text>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  planBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, backgroundColor: palette.brandLight, borderRadius: radius.md, padding: spacing.md },
  planIcon: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  clockBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm, backgroundColor: palette.successBg, borderRadius: radius.md, padding: spacing.md },
  clockIcon: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  quickAction: { flex: 1, alignItems: "center", gap: 6, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.md },
  quickIcon: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  hero: { fontSize: 34, fontWeight: fontWeight.bold as any, letterSpacing: -0.5, marginTop: 4 },
  statRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  vline: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: palette.line },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  stripHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm },
  urgentHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  countPill: { minWidth: 20, height: 20, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  moreRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  statRow2: { flexDirection: "row", alignItems: "center" },
  perfHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: palette.surfaceSunken, marginTop: 5, overflow: "hidden" },
  barFill: { height: 5, borderRadius: 3 },
  // Bleed the strip past the Screen's padding so it reads as a full-width rail.
  stripBleed: { marginHorizontal: -spacing.lg },
  strip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 2 },
  dayChip: { width: 52, alignItems: "center", gap: 2, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  dayChipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  dayChipToday: { borderColor: palette.brand },
  dayNum: { fontSize: 17, fontWeight: fontWeight.bold as any },
  dotRow: { flexDirection: "row", gap: 3, height: 5, alignItems: "center" },
  dot: { width: 5, height: 5, borderRadius: 3 },
  attnChip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  roundIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  groupTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  // Caps the day's task list to ~4 rows before it scrolls internally, so a big
  // backlog can't push the rest of Home (numbers, touchpoints) off-screen.
  tasksScroll: { maxHeight: 260 },
  planRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  avatar: { width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
  wishBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.success, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
