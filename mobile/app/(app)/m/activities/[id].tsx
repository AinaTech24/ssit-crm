/**
 * Activity detail — re-read a logged call/visit: what was discussed (notes),
 * the outcome, duration, when, and who with. Edit the notes/outcome/follow-up
 * inline, call/WhatsApp the client, jump to their profile, and scroll their full
 * interaction timeline (every activity for this client) right below.
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { TextField } from "../../../../src/components/ui/TextField";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import {
  useActivity, useActivityTimeline, useUpdateActivity, useDeleteActivity,
  kindMeta, outcomeBadge, ACTIVITY_OUTCOMES, type Activity,
} from "../../../../src/features/activities/api";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { fmtDate, timeAgo, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

/** Opens WhatsApp and records the touch against the same client. */
const openWa = (p?: string | null, subject?: { type: "investor" | "lead" | "family"; id: string | null; name?: string | null }) =>
  openWhatsApp({ phone: p, subjectType: subject?.type, subjectId: subject?.id, name: subject?.name });
function whenLabel(at?: string | null): string { if (!at) return "—"; const d = new Date(at); return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function durationLabel(sec?: number | null): string | null { if (!sec || sec <= 0) return null; const m = Math.floor(sec / 60), s = sec % 60; return m > 0 ? `${m}m ${s}s` : `${s}s`; }

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const aid = String(id);
  const { data: a, isLoading } = useActivity(aid);
  const update = useUpdateActivity(aid);
  const del = useDeleteActivity();
  const timeline = useActivityTimeline(a?.subject_type, a?.subject_id);

  const [editOpen, setEditOpen] = React.useState(false);
  const [notes, setNotes] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<string | null>(null);

  if (isLoading || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Activity" />
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
      </View>
    );
  }

  const meta = kindMeta(a.kind);
  const badge = outcomeBadge(a.status);
  const dur = durationLabel(a.duration_sec);
  const notesVal = notes ?? a.notes ?? "";
  const outcomeVal = outcome ?? a.status ?? "";
  const openClient = () => {
    if (a.subject_type === "investor" && a.subject_id) router.push(`/m/investors/${a.subject_id}` as any);
    else if (a.subject_type === "lead" && a.subject_id) router.push(`/m/leads/${a.subject_id}` as any);
  };

  const saveEdit = () => {
    update.mutate(
      { notes: notesVal, status: outcomeVal || null },
      { onSuccess: () => { toast.success("Activity updated"); setEditOpen(false); } }
    );
  };
  const remove = () => {
    confirmDelete({ title: "Delete activity?", message: "Removes this log entry.", confirmLabel: "Delete" }, () => {
      del.mutate(aid, { onSuccess: () => { toast.success("Activity deleted"); router.back(); } });
    });
  };

  const others = (timeline.data ?? []).filter((t) => t.id !== a.id);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader
        title={meta.label}
        subtitle={timeAgo(a.occurred_at)}
        right={<Pressable onPress={() => setEditOpen(true)} hitSlop={8} style={styles.editBtn}><Feather name="edit-2" size={15} color={palette.white} /></Pressable>}
      />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Hero */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={[styles.kindIcon, { backgroundColor: toneColors(meta.tone).bg }]}><Feather name={meta.icon as any} size={18} color={toneColors(meta.tone).fg} /></View>
            <Pressable style={{ flex: 1 }} onPress={openClient}>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold as any }} numberOfLines={1}>{a.subject_name ?? "—"}</Text>
              <Text variant="caption" tone="muted">{a.subject_type ? titleCase(a.subject_type) : ""}{a.direction ? ` · ${titleCase(a.direction)}` : ""}</Text>
            </Pressable>
            {a.status ? <StatusPill label={badge.label} tone={badge.tone} size="sm" /> : null}
          </View>
          <View style={styles.metaRow}>
            <Meta icon="clock" text={whenLabel(a.occurred_at)} />
            {dur ? <Meta icon="watch" text={dur} /> : null}
            {a.location_label ? <Meta icon="map-pin" text={a.location_label} /> : null}
          </View>
          {a.subject_phone ? (
            <View style={styles.actionRow}>
              <Pressable style={[styles.actBtn, { backgroundColor: palette.brand }]} onPress={() => startCall({ subjectType: (a.subject_type as any) ?? "investor", subjectId: a.subject_id ?? "", name: a.subject_name ?? "Client", phone: a.subject_phone ?? "" })}>
                <Feather name="phone" size={15} color={palette.white} /><Text style={styles.actTxt}>Call</Text>
              </Pressable>
              <Pressable style={[styles.actBtn, { backgroundColor: palette.success }]} onPress={() => openWa(a.subject_phone, { type: (a.subject_type as any) ?? "investor", id: a.subject_id, name: a.subject_name })}>
                <Feather name="message-circle" size={15} color={palette.white} /><Text style={styles.actTxt}>WhatsApp</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>

        {/* Discussion / notes */}
        <SectionLabel text="DISCUSSION" />
        <Pressable onPress={() => setEditOpen(true)}>
          <Card flat>
            {notesVal ? (
              <Text variant="body" style={{ color: palette.ink, lineHeight: 22 }}>{notesVal}</Text>
            ) : (
              <Text variant="body" tone="muted">No notes recorded — tap to add what was discussed.</Text>
            )}
          </Card>
        </Pressable>

        {/* Follow-up */}
        {a.next_followup_at ? (
          <>
            <SectionLabel text="NEXT FOLLOW-UP" />
            <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Feather name="corner-up-right" size={16} color={toneColors("warning").fg} />
              <Text variant="body" style={{ color: palette.ink }}>{fmtDate(a.next_followup_at)}</Text>
            </Card>
          </>
        ) : null}

        {a.owner_name ? <Text variant="caption" tone="faint" style={{ marginTop: spacing.md }}>Logged by {a.owner_name}</Text> : null}

        {/* Client timeline */}
        {a.subject_id ? (
          <>
            <SectionLabel text={`${(a.subject_name ?? "CLIENT").toUpperCase()} · TIMELINE`} />
            <Card flat style={{ padding: 0, overflow: "hidden" }}>
              {timeline.isLoading ? (
                <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={40} /></View>
              ) : others.length === 0 ? (
                <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">No other interactions logged yet.</Text></View>
              ) : (
                others.slice(0, 20).map((t, i) => <TimelineRow key={t.id} t={t} last={i === Math.min(others.length, 20) - 1} onPress={() => router.push(`/m/activities/${t.id}` as any)} />)
              )}
            </Card>
          </>
        ) : null}

        <Pressable onPress={remove} style={{ alignSelf: "center", marginTop: spacing.xl, padding: spacing.md }}>
          <Text variant="caption" style={{ color: toneColors("danger").fg }}>Delete activity</Text>
        </Pressable>
      </Screen>

      {/* Edit sheet */}
      <BottomSheet visible={editOpen} onClose={() => setEditOpen(false)} title="Edit activity">
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Outcome</Text>
        <Segmented
          options={ACTIVITY_OUTCOMES.slice(0, 4).map((o) => ({ key: o.value, label: o.label }))}
          value={outcomeVal || "completed"}
          onChange={(v) => setOutcome(v)}
        />
        <View style={{ height: spacing.lg }} />
        <TextField label="Discussion notes" value={notesVal} onChangeText={setNotes} multiline placeholder="What was discussed…" />
        <Pressable style={[styles.actBtn, { backgroundColor: palette.brand }]} onPress={saveEdit} disabled={update.isPending}>
          <Text style={styles.actTxt}>{update.isPending ? "Saving…" : "Save"}</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

function TimelineRow({ t, last, onPress }: { t: Activity; last: boolean; onPress: () => void }) {
  const meta = kindMeta(t.kind);
  return (
    <Pressable style={[styles.tlRow, !last && styles.divider]} onPress={onPress}>
      <View style={[styles.tlIcon, { backgroundColor: toneColors(meta.tone).bg }]}><Feather name={meta.icon as any} size={13} color={toneColors(meta.tone).fg} /></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{t.subject || t.notes || meta.label}</Text>
        <Text variant="caption" tone="muted">{meta.label} · {timeAgo(t.occurred_at)}</Text>
      </View>
      <Feather name="chevron-right" size={15} color={palette.faint} />
    </Pressable>
  );
}

function Meta({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Feather name={icon} size={12} color={palette.muted} /><Text variant="caption" tone="muted">{text}</Text></View>;
}
function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  editBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  kindIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md },
  actTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
  tlRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  tlIcon: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
