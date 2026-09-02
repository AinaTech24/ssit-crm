/**
 * Service request detail — read the ask, move the status, record how it was
 * resolved, and jump to the client. This is what turns Home's "SLA breached"
 * card from a dead end into something an RM can actually close out.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { TextField } from "../../../../src/components/ui/TextField";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import {
  useServiceRequest, useUpdateServiceRequest, srStatusMeta, isSlaBreached,
  SR_STATUSES, PRIORITY_TONE, type SrStatus,
} from "../../../../src/features/service-requests/api";
import { toast } from "../../../../src/lib/toast";
import { fmtDate, timeAgo, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

export default function ServiceRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const sid = String(id);
  const { data: r, isLoading } = useServiceRequest(sid);
  const update = useUpdateServiceRequest(sid);

  const [statusOpen, setStatusOpen] = React.useState(false);
  const [notes, setNotes] = React.useState<string | null>(null);

  if (isLoading || !r) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Request" />
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
      </View>
    );
  }

  const meta = srStatusMeta(r.status);
  const breached = isSlaBreached(r);
  const notesVal = notes ?? r.resolutionNotes ?? "";

  const setStatus = (status: SrStatus) => {
    update.mutate({ status }, { onSuccess: () => { toast.success(`Marked ${srStatusMeta(status).label.toLowerCase()}`); setStatusOpen(false); } });
  };
  const saveNotes = () => {
    update.mutate({ resolutionNotes: notesVal }, { onSuccess: () => toast.success("Resolution saved") });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={r.ticketNo ?? "Request"} subtitle={r.type ? titleCase(r.type.replace(/_/g, " ")) : undefined} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Hero */}
        <Card style={breached ? { borderLeftWidth: 3, borderLeftColor: toneColors("danger").fg } : undefined}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <Text variant="title" style={{ flex: 1 }}>{r.subject ?? "Request"}</Text>
            <Pressable onPress={() => setStatusOpen(true)}><StatusPill label={meta.label} tone={meta.tone} size="sm" /></Pressable>
          </View>
          <View style={styles.metaRow}>
            {r.priority ? <StatusPill label={titleCase(r.priority)} tone={PRIORITY_TONE[r.priority] ?? "neutral"} size="sm" dot={false} /> : null}
            {breached ? <StatusPill label="SLA passed" tone="danger" size="sm" dot={false} /> : null}
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="faint">Raised {timeAgo(r.createdAt)}</Text>
          </View>
          {r.slaResolutionAt ? (
            <Text variant="caption" style={{ marginTop: spacing.sm, color: breached ? toneColors("danger").fg : palette.muted }}>
              {breached ? "Was due " : "Due "}{fmtDate(r.slaResolutionAt)}
            </Text>
          ) : null}
        </Card>

        {/* What the client asked */}
        {r.description ? (
          <>
            <SectionLabel text="REQUEST" />
            <Card flat><Text variant="body" style={{ color: palette.ink, lineHeight: 21 }}>{r.description}</Text></Card>
          </>
        ) : null}

        {/* Move it along */}
        <SectionLabel text="UPDATE STATUS" />
        <View style={styles.statusRow}>
          {(["in_progress", "waiting_customer", "resolved"] as SrStatus[]).map((s) => {
            const m = srStatusMeta(s);
            const active = r.status === s;
            return (
              <Pressable key={s} style={[styles.statusBtn, active && { backgroundColor: toneColors(m.tone).bg, borderColor: toneColors(m.tone).fg }]} onPress={() => setStatus(s)} disabled={update.isPending}>
                <Text variant="caption" style={{ color: active ? toneColors(m.tone).fg : palette.ink, fontWeight: fontWeight.semibold as any }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Resolution */}
        <SectionLabel text="RESOLUTION NOTES" />
        <Card flat>
          <TextField label="How was it resolved?" value={notesVal} onChangeText={setNotes} multiline placeholder="What you did, and what you told the client…" />
          <Pressable style={styles.saveBtn} onPress={saveNotes} disabled={update.isPending}>
            <Feather name="check" size={16} color={palette.white} />
            <Text style={styles.btnTxt}>{update.isPending ? "Saving…" : "Save"}</Text>
          </Pressable>
        </Card>

        {r.investorId ? (
          <Pressable style={[styles.saveBtn, { backgroundColor: palette.brand, marginTop: spacing.xl }]} onPress={() => router.push(`/m/investors/${r.investorId}` as any)}>
            <Feather name="user" size={16} color={palette.white} />
            <Text style={styles.btnTxt}>Open client</Text>
          </Pressable>
        ) : null}
      </Screen>

      {/* Full status picker */}
      <BottomSheet visible={statusOpen} onClose={() => setStatusOpen(false)} title="Set status">
        {SR_STATUSES.map((s) => (
          <Pressable key={s.value} style={styles.pickRow} onPress={() => setStatus(s.value)}>
            <View style={[styles.dot, { backgroundColor: toneColors(s.tone).fg }]} />
            <Text variant="body" style={{ flex: 1 }}>{s.label}</Text>
            {r.status === s.value ? <Feather name="check" size={16} color={toneColors("success").fg} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  statusBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: radius.md, paddingVertical: spacing.md },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.success, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  btnTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
