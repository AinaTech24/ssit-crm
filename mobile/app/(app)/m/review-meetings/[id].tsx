/**
 * Meeting detail + editor — web parity with ReviewMeetingDetailEditor.
 *
 * Header (subject / type / who / when / RM) · prep brief (upcoming investor
 * meetings) · status + Mark completed + Save · schedule/reschedule · attendees ·
 * discussion · notes (+ AI summarise) · outcome · action items · attachments ·
 * next review date · cancel.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { DateField } from "../../../../src/components/form/DateField";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { confirmDelete } from "../../../../src/lib/confirm";
import {
  useMeeting, useUpdateMeeting, useCancelMeeting,
  MEETING_STATUSES, MEETING_MODES, MEETING_OUTCOMES, ATTENDEE_ROLES, isExternalRole, OUTCOME_TONE,
} from "../../../../src/features/meetings/api";
import { api, ApiError } from "../../../../src/api/client";
import { meetingStatusBadge } from "../../../../src/lib/status";
import { titleCase, inr } from "../../../../src/lib/format";
import { palette, spacing, radius, fontWeight } from "../../../../src/theme/tokens";

type ActionItem = { title: string; dueAt?: string; taskId?: string };
type Attachment = { name: string; url: string };
type Attendee = { name: string; role: string; isExternal: boolean; notes?: string };

// 15-minute time slots, 12-hour labels (mirrors the web TIME_SLOTS).
const TIME_SLOTS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) {
    const hh = String(h).padStart(2, "0"), mm = String(m).padStart(2, "0");
    const ampm = h < 12 ? "AM" : "PM", h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
  }
  return out;
})();

function splitLocal(v: any): { day: string; time: string } {
  if (!v) return { day: "", time: "11:00" };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { day: "", time: "11:00" };
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
function defaultNextReview(): string {
  const d = new Date(); d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}
function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" });
}

export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: m, isLoading, isError, error, refetch } = useMeeting(id);
  const update = useUpdateMeeting(id);
  const cancel = useCancelMeeting(id);

  // ── Editor state (hydrated once the meeting loads) ──
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [status, setStatus] = useState("scheduled");
  const [subject, setSubject] = useState("");
  const [meetingDay, setMeetingDay] = useState("");
  const [meetingTime, setMeetingTime] = useState("11:00");
  const [origDay, setOrigDay] = useState("");
  const [origTime, setOrigTime] = useState("11:00");
  const [meetingMode, setMeetingMode] = useState("office");
  const [location, setLocation] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [discussion, setDiscussion] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [items, setItems] = useState<ActionItem[]>([]);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [newAtt, setNewAtt] = useState<Attendee>({ name: "", role: "investor", isExternal: true });
  const [nextReview, setNextReview] = useState(defaultNextReview());
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!m || hydratedId === m.id) return;
    const dt = splitLocal(m.meeting_date);
    setStatus(m.status ?? "scheduled");
    setSubject(m.subject ?? "");
    setMeetingDay(dt.day); setMeetingTime(dt.time); setOrigDay(dt.day); setOrigTime(dt.time);
    setMeetingMode(m.meeting_mode ?? "office");
    setLocation(m.location_or_link ?? "");
    setDiscussion(m.discussion_points ?? "");
    setNotes(m.meeting_notes ?? "");
    setOutcome(m.outcome ?? "");
    setOutcomeNotes(m.outcome_notes ?? "");
    setItems(Array.isArray(m.action_items) ? (m.action_items as ActionItem[]) : []);
    setAtts(Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : []);
    setAttendees(Array.isArray(m.attendees) ? (m.attendees as Attendee[]) : []);
    setNextReview(m.next_review_date ? String(m.next_review_date).slice(0, 10) : defaultNextReview());
    setHydratedId(m.id);
  }, [m, hydratedId]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Meeting" onBack={() => router.back()} /><LoadingState /></View>;
  if (isError || !m) return <View style={styles.screen}><ScreenHeader title="Meeting" onBack={() => router.back()} /><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></View>;

  const st = meetingStatusBadge(status);
  const who = m.subject_name ?? m.investor_name ?? m.lead_name ?? "Subject";
  const subjectKind = m.lead_id ? "Lead" : "Client";
  const dateMoved = !!meetingDay && (meetingDay !== origDay || meetingTime !== origTime);
  const prep = m.prep;

  async function save(overrideStatus?: string) {
    setErr(null); setOk(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const payload: Record<string, any> = {
      status: overrideStatus ?? status,
      subject: subject || undefined,
      discussionPoints: discussion || undefined,
      meetingNotes: notes || undefined,
      actionItems: items.filter((i) => i.title.trim().length > 0),
      attachments: atts.filter((a) => a.url.trim().length > 0),
      attendees: attendees.filter((a) => a.name.trim().length > 0),
      nextReviewDate: nextReview || undefined,
      outcome: outcome || undefined,
      outcomeNotes: outcomeNotes || undefined,
      meetingMode: meetingMode || undefined,
      locationOrLink: location || undefined,
      ...(dateMoved ? { meetingDate: new Date(`${meetingDay}T${meetingTime || "11:00"}:00`).toISOString(), rescheduleReason: rescheduleReason || undefined } : {}),
    };
    try {
      const res = await update.mutateAsync(payload);
      if (overrideStatus === "completed" || res?.completed) {
        setStatus("completed");
        setOk(`Marked completed · action items became tasks · next review set to ${nextReview}.`);
      } else setOk("Saved.");
      setRescheduleReason("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save. Please try again.");
    }
  }

  async function runAiSummary() {
    if (notes.trim().length < 20) { setErr("Write at least 20 characters of notes first."); return; }
    setAiBusy(true); setErr(null);
    try {
      const j: any = await api.post("/api/ai/meeting-summary", {
        notes, agenda: discussion || undefined, meetingType: m!.meeting_type,
        durationMinutes: m!.duration_minutes ? Number(m!.duration_minutes) : undefined, clientName: who,
      });
      const block = [
        j.summary,
        j.keyPoints?.length ? "\n\nKey points:\n" + j.keyPoints.map((p: string) => `  • ${p}`).join("\n") : "",
        j.decisions?.length ? "\n\nDecisions:\n" + j.decisions.map((p: string) => `  • ${p}`).join("\n") : "",
        j.nextSteps?.length ? "\n\nNext steps:\n" + j.nextSteps.map((p: string) => `  • ${p}`).join("\n") : "",
      ].filter(Boolean).join("").trim();
      setNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n— AI summary —\n${block}` : block));
      if (j.actionItems?.length) setItems((prev) => [...prev, ...j.actionItems.map((a: any) => ({ title: a.title }))]);
      setOk("AI summary applied — review + Save when ready.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "AI request failed.");
    } finally { setAiBusy(false); }
  }

  const doCancel = () => confirmDelete(
    { title: "Cancel this meeting?", message: "It's marked cancelled and the reminder task is cleared.", confirmLabel: "Cancel meeting" },
    () => cancel.mutate(undefined, { onSuccess: () => router.back() })
  );

  const busy = update.isPending;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={m.subject ?? "Meeting"} subtitle={titleCase(m.meeting_type) || undefined} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInUp.duration(240)}>
          {/* Header */}
          <Card>
            <Text variant="title">{m.subject ?? `${who} · ${titleCase(m.meeting_type)}`}</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{who} · {subjectKind}</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{fmtWhen(m.meeting_date)} · {titleCase(m.meeting_mode)}{m.rm_name ? ` · RM: ${m.rm_name}` : ""}</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" }}>
              <StatusPill label={st.label} tone={st.tone} />
              {outcome ? <StatusPill label={titleCase(outcome)} tone={OUTCOME_TONE[outcome] ?? "neutral"} dot={false} /> : null}
              {Number(m.reschedule_count ?? 0) > 0 ? <StatusPill label={`rescheduled ${m.reschedule_count}×`} tone="warning" dot={false} /> : null}
            </View>
          </Card>

          {/* Prep brief */}
          {prep ? (
            <Card style={{ marginTop: spacing.lg }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md }}>
                <Feather name="target" size={15} color={palette.brand} />
                <Text variant="subtitle">Prep brief</Text>
                <Text variant="caption" tone="faint">— walk in ready</Text>
              </View>
              <View style={styles.prepGrid}>
                <Prep label="AUM" value={inr(prep.aum ?? 0)} />
                <Prep label="Monthly SIP" value={inr(prep.active_sip_amount ?? 0)} />
                <Prep label="Last review" value={prep.last_review_at ? new Date(prep.last_review_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "Never"} tone={!prep.last_review_at ? palette.danger : undefined} />
                <Prep label="Open requests" value={String(prep.open_srs ?? 0)} tone={Number(prep.open_srs) > 0 ? palette.warning : undefined} />
                <Prep label="SIP bounces 6mo" value={String(prep.bounces_6mo ?? 0)} tone={Number(prep.bounces_6mo) > 0 ? palette.danger : undefined} />
                <Prep label="Goals" value={String(prep.goals_count ?? 0)} />
              </View>
              {m.investor_id ? (
                <Pressable onPress={() => router.push(`/m/investors/${m.investor_id}` as any)} style={{ marginTop: spacing.md }}>
                  <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Open Client 360 →</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          {ok ? <Banner tone="success" text={ok} /> : null}
          {err ? <Banner tone="danger" text={err} /> : null}

          {/* Status + actions */}
          <Card style={{ marginTop: spacing.lg }}>
            <SelectField label="Status" value={status} options={MEETING_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} onChange={setStatus} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              {status !== "completed" ? (
                <View style={{ flex: 1 }}><Button label="Mark completed" variant="secondary" loading={busy} onPress={() => save("completed")} icon={<Feather name="check-circle" size={15} color={palette.success} />} full /></View>
              ) : null}
              <View style={{ flex: 1 }}><Button label="Save" loading={busy} onPress={() => save()} icon={<Feather name="save" size={15} color="#fff" />} full /></View>
            </View>
          </Card>

          {/* Subject */}
          <Card style={{ marginTop: spacing.lg }}>
            <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Q1 portfolio review + tax-saving + nominee update" />
          </Card>

          {/* Schedule / reschedule */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.md }}>Schedule</Text>
            <DateField label="Date" value={meetingDay} onChange={setMeetingDay} />
            <SelectField label="Time" value={meetingTime} options={TIME_SLOTS} onChange={setMeetingTime} />
            <SelectField label="Mode" value={meetingMode} options={MEETING_MODES.map((v) => ({ value: v, label: titleCase(v) }))} onChange={setMeetingMode} />
            <TextField label="Location / link" value={location} onChangeText={setLocation} placeholder="Office / address / video link" />
            {dateMoved ? (
              <>
                <TextField label="Reschedule reason" value={rescheduleReason} onChangeText={setRescheduleReason} placeholder="Why is this being moved? (optional)" />
                <Text variant="caption" tone="warning">Saving moves the T-1 reminder task to the new date and logs a reschedule.</Text>
              </>
            ) : null}
          </Card>

          {/* Attendees */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Attendees ({attendees.length})</Text>
            {attendees.length === 0 ? (
              <Text variant="caption" tone="muted">Add who was in the room — spouse, family CA, AMC RM, etc.</Text>
            ) : attendees.map((a, i) => (
              <View key={i} style={styles.rowItem}>
                <StatusPill label={ATTENDEE_ROLES.find((r) => r.value === a.role)?.label ?? a.role} tone={a.isExternal ? "violet" : "info"} size="sm" dot={false} />
                <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{a.name}{a.notes ? ` · ${a.notes}` : ""}</Text>
                <Pressable onPress={() => setAttendees((p) => p.filter((_, idx) => idx !== i))} hitSlop={8}><Feather name="x" size={16} color={palette.danger} /></Pressable>
              </View>
            ))}
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              <TextField label="Add attendee" value={newAtt.name} onChangeText={(v) => setNewAtt((p) => ({ ...p, name: v }))} placeholder="Name" />
              <SelectField label="Role" value={newAtt.role} options={ATTENDEE_ROLES} onChange={(v) => setNewAtt((p) => ({ ...p, role: v, isExternal: isExternalRole(v) }))} />
              <Button label="Add attendee" variant="secondary" icon={<Feather name="plus" size={15} color={palette.ink} />} onPress={() => { if (!newAtt.name.trim()) return; setAttendees((p) => [...p, { ...newAtt }]); setNewAtt({ name: "", role: "investor", isExternal: true }); }} />
            </View>
          </Card>

          {/* Discussion */}
          <Card style={{ marginTop: spacing.lg }}>
            <TextField label="Discussion points (agenda)" value={discussion} onChangeText={setDiscussion} placeholder="What you plan to cover with the client…" multiline />
          </Card>

          {/* Notes + AI */}
          <Card style={{ marginTop: spacing.lg }}>
            <TextField label="Meeting notes" value={notes} onChangeText={setNotes} placeholder="What was discussed, decisions, mood, follow-up needed…" multiline />
            <Button label="AI summarise" variant="secondary" loading={aiBusy} onPress={runAiSummary} icon={<Feather name="zap" size={15} color={palette.violet} />} />
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Completing without notes auto-creates a 24-hour "write up your notes" task.</Text>
          </Card>

          {/* Outcome */}
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.md }}>Outcome</Text>
            <SelectField label="Result" value={outcome} options={[{ value: "", label: "— Not captured —" }, ...MEETING_OUTCOMES]} onChange={setOutcome} placeholder="— Not captured —" />
            <TextField label="Outcome notes" value={outcomeNotes} onChangeText={setOutcomeNotes} placeholder="Optional context" />
            <Text variant="caption" tone="muted">For lead meetings the outcome moves the journey: Ready → won, Not interested → closed, Wants more info / Not ready → re-nurture in 7 days.</Text>
          </Card>

          {/* Action items */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text variant="subtitle">Action items ({items.length})</Text>
              <Pressable onPress={() => setItems((s) => [...s, { title: "" }])} hitSlop={8}><Feather name="plus" size={18} color={palette.brand} /></Pressable>
            </View>
            {items.length === 0 ? (
              <Text variant="caption" tone="muted">Each item becomes an RM task when this meeting is marked completed.</Text>
            ) : items.map((it, i) => (
              <View key={i} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <TextField label={`Item ${i + 1}`} value={it.title} onChangeText={(v) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, title: v } : x))} placeholder="e.g. Send tax-saving fund note by Tue" />
                  </View>
                  {it.taskId ? (
                    <View style={{ paddingTop: 26 }}><StatusPill label="task ✓" tone="success" size="sm" dot={false} /></View>
                  ) : (
                    <Pressable onPress={() => setItems((s) => s.filter((_, idx) => idx !== i))} hitSlop={8} style={{ paddingTop: 30 }}><Feather name="trash-2" size={16} color={palette.danger} /></Pressable>
                  )}
                </View>
                <DateField label="Due" value={it.dueAt ?? ""} onChange={(v) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, dueAt: v } : x))} />
              </View>
            ))}
          </Card>

          {/* Attachments */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text variant="subtitle">Attachments ({atts.length})</Text>
              <Pressable onPress={() => setAtts((s) => [...s, { name: "", url: "" }])} hitSlop={8}><Feather name="plus" size={18} color={palette.brand} /></Pressable>
            </View>
            {atts.length === 0 ? (
              <Text variant="caption" tone="muted">Paste a link to a presentation, report, or signed document.</Text>
            ) : atts.map((a, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField label={`Name ${i + 1}`} value={a.name} onChangeText={(v) => setAtts((s) => s.map((x, idx) => idx === i ? { ...x, name: v } : x))} placeholder="Display name" />
                  <TextField label="URL" value={a.url} onChangeText={(v) => setAtts((s) => s.map((x, idx) => idx === i ? { ...x, url: v } : x))} placeholder="https://…" autoCapitalize="none" />
                </View>
                <Pressable onPress={() => setAtts((s) => s.filter((_, idx) => idx !== i))} hitSlop={8} style={{ paddingTop: 30 }}><Feather name="trash-2" size={16} color={palette.danger} /></Pressable>
              </View>
            ))}
          </Card>

          {/* Next review */}
          <Card style={{ marginTop: spacing.lg }}>
            <DateField label="Next review date" value={nextReview} onChange={setNextReview} help="On completion, the client's next review is set to this date." />
          </Card>

          {/* Cancel */}
          {status !== "cancelled" ? (
            <Button label="Cancel meeting" variant="danger" loading={cancel.isPending} onPress={doCancel} icon={<Feather name="x-circle" size={15} color="#fff" />} style={{ marginTop: spacing.lg }} />
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Prep({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.prepCell}>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: fontWeight.bold as any, color: tone ?? palette.ink }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Banner({ tone, text }: { tone: "success" | "danger"; text: string }) {
  const bg = tone === "success" ? palette.successBg ?? "#ECFDF5" : palette.dangerBg;
  const fg = tone === "success" ? palette.success : palette.danger;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg }}>
      <Text variant="body" style={{ color: fg }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  prepGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  prepCell: { width: "31%", backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
