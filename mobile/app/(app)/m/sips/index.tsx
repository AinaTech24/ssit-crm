/**
 * SIP Tracker — leads with what's leaking. "At risk" (mandate bounced) sits on
 * top with the rupee value at stake, because a bounced SIP is book value walking
 * out this month. Tapping a row opens the actions sheet: Save the SIP (raises a
 * high-priority recovery task) or open the client.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Chip } from "../../../../src/components/ui/Chip";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { TextField } from "../../../../src/components/ui/TextField";
import { useSips, useDefendSip, bucketSips, sumAmount, isAtRisk, failureCount, type Sip } from "../../../../src/features/sips/api";
import { AssignOpsSheet } from "../../../../src/features/tasks/AssignOpsSheet";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

type Bucket = "atRisk" | "live" | "stopped" | "all";
const TABS: { key: Bucket; label: string }[] = [
  { key: "atRisk", label: "At risk" },
  { key: "live", label: "Live" },
  { key: "stopped", label: "Stopped" },
  { key: "all", label: "All" },
];

export default function SipTracker() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useSips();
  const [tab, setTab] = React.useState<Bucket>("atRisk");
  const [sheet, setSheet] = React.useState<Sip | null>(null);
  const [opsFor, setOpsFor] = React.useState<Sip | null>(null);

  const b = bucketSips(data);
  const rows = b[tab];
  const atRiskValue = sumAmount(b.atRisk);

  const header = (
    <View style={{ paddingBottom: spacing.sm }}>
      {/* Money at stake — the reason this screen exists */}
      <Card style={{ marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: b.atRisk.length ? toneColors("danger").fg : palette.line }}>
        <Text variant="caption" tone="faint">AT RISK — BOUNCED MANDATES</Text>
        <Text style={styles.hero}>{b.atRisk.length ? inr(atRiskValue) : "All clear"}</Text>
        <Text variant="caption" tone="muted">
          {b.atRisk.length
            ? `${b.atRisk.length} SIP${b.atRisk.length === 1 ? "" : "s"} bouncing · ${b.live.length} live`
            : `${b.live.length} live SIP${b.live.length === 1 ? "" : "s"} · nothing bouncing`}
        </Text>
      </Card>
      <View style={styles.chips}>
        {TABS.map((t) => (
          <Chip key={t.key} label={`${t.label} (${b[t.key].length})`} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="SIP Tracker" subtitle={`${b.all.length} SIPs`} />
      {isLoading ? (
        <View style={{ padding: spacing.lg }}>
          {header}
          <Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} />
          <Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} />
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: spacing["2xl"], gap: spacing.md }}>
              <Feather name={tab === "atRisk" ? "check-circle" : "repeat"} size={22} color={palette.faint} />
              <Text variant="body" tone="muted">{tab === "atRisk" ? "No bounced SIPs — nice." : "Nothing here."}</Text>
            </View>
          }
          renderItem={({ item }) => <SipRow s={item} onPress={() => setSheet(item)} />}
        />
      )}
      <SipSheet
        sip={sheet}
        onClose={() => setSheet(null)}
        onOpenClient={(id) => { setSheet(null); router.push(`/m/investors/${id}` as any); }}
        onAssignOps={(s) => { setSheet(null); setOpsFor(s); }}
      />
      {/* Ops handoff, pre-filled with the bounce reason so nobody re-diagnoses it. */}
      {opsFor?.investorId ? (
        <AssignOpsSheet
          visible={!!opsFor}
          onClose={() => setOpsFor(null)}
          subjectType="investor"
          subjectId={opsFor.investorId}
          subjectName={opsFor.investorName}
          defaultTitle={`Fix bounced SIP — ${opsFor.lastFailureReason ?? opsFor.schemeName ?? "mandate"}`}
        />
      ) : null}
    </View>
  );
}

function SipRow({ s, onPress }: { s: Sip; onPress: () => void }) {
  const risk = isAtRisk(s);
  const tone: Tone = risk ? "danger" : "neutral";
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: spacing.sm, ...(risk ? { borderLeftWidth: 3, borderLeftColor: toneColors("danger").fg } : null) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold as any }} numberOfLines={1}>{s.investorName ?? "—"}</Text>
          {s.amount ? <Text variant="body" style={{ fontWeight: fontWeight.bold as any }}>{inr(s.amount)}</Text> : null}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>{s.schemeName ?? "—"}</Text>
        {/* The reason IS the next action — "mandate expired" vs "insufficient funds"
            are two completely different conversations with the client. */}
        {risk && s.lastFailureReason ? (
          <View style={styles.reasonRow}>
            <Feather name="alert-triangle" size={12} color={toneColors("danger").fg} />
            <Text variant="caption" style={{ color: toneColors("danger").fg, flex: 1 }} numberOfLines={1}>{s.lastFailureReason}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          {risk ? <StatusPill label={`${failureCount(s)} bounce${failureCount(s) === 1 ? "" : "s"}`} tone={tone} size="sm" /> : null}
          {s.status ? <Text variant="caption" tone="faint">{titleCase(s.status)}</Text> : null}
          <View style={{ flex: 1 }} />
          {s.nextDate ? <Text variant="caption" tone="faint">Next {fmtDate(s.nextDate)}</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function SipSheet({ sip, onClose, onOpenClient, onAssignOps }: { sip: Sip | null; onClose: () => void; onOpenClient: (investorId: string) => void; onAssignOps: (s: Sip) => void }) {
  const defend = useDefendSip();
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (sip) setNote(""); }, [sip]);
  if (!sip) return null;
  const risk = isAtRisk(sip);

  const save = () => {
    defend.mutate(
      { id: sip.id, note: note.trim() || undefined },
      {
        onSuccess: (r) => { toast.success(r?.deduped ? "Recovery task already open" : "Recovery task created"); onClose(); },
        onError: (e: any) => toast.error(e?.body?.error || "Couldn't create the task"),
      }
    );
  };

  return (
    <BottomSheet visible={!!sip} onClose={onClose} title={sip.investorName ?? "SIP"}>
      <Text variant="body" style={{ color: palette.ink }}>{sip.schemeName ?? "—"}</Text>
      <View style={styles.metaRow}>
        {sip.amount ? <Meta label="Instalment" value={inr(sip.amount)} /> : null}
        {sip.frequency ? <Meta label="Frequency" value={titleCase(sip.frequency)} /> : null}
        {risk ? <Meta label="Bounces" value={String(failureCount(sip))} tone="danger" /> : null}
      </View>
      {risk && sip.lastFailureReason ? (
        <View style={[styles.reasonBox, { backgroundColor: toneColors("danger").bg }]}>
          <Text variant="caption" style={{ color: toneColors("danger").fg, fontWeight: fontWeight.semibold as any }}>Why it bounced</Text>
          <Text variant="body" style={{ color: palette.ink, marginTop: 2 }}>{sip.lastFailureReason}</Text>
        </View>
      ) : null}
      {sip.folioNumber ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>Folio {sip.folioNumber}</Text> : null}

      {risk ? (
        <>
          <View style={{ height: spacing.md }} />
          <TextField label="Note for the recovery task (optional)" value={note} onChangeText={setNote} multiline placeholder="e.g. Client says bank balance issue, will fund by 5th" />
          <Pressable style={[styles.btn, { backgroundColor: toneColors("danger").fg }]} onPress={save} disabled={defend.isPending}>
            <Feather name="shield" size={16} color={palette.white} />
            <Text style={styles.btnTxt}>{defend.isPending ? "Creating…" : "Save this SIP"}</Text>
          </Pressable>
          <Text variant="caption" tone="faint" style={{ textAlign: "center", marginTop: spacing.sm }}>
            Raises a high-priority follow-up task for this client's RM.
          </Text>
        </>
      ) : null}

      {/* A bounced mandate is usually ops work, not advice — hand it over from here. */}
      {sip.investorId ? (
        <Pressable style={[styles.btn, { backgroundColor: palette.violet, marginTop: spacing.md }]} onPress={() => onAssignOps(sip)}>
          <Feather name="users" size={16} color={palette.white} />
          <Text style={styles.btnTxt}>Assign to team</Text>
        </Pressable>
      ) : null}

      {sip.investorId ? (
        <Pressable style={[styles.btn, { backgroundColor: palette.brand, marginTop: spacing.md }]} onPress={() => onOpenClient(sip.investorId!)}>
          <Feather name="user" size={16} color={palette.white} />
          <Text style={styles.btnTxt}>Open client</Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return <View style={{ flex: 1 }}><Text variant="caption" tone="faint">{label}</Text><Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: tone ? toneColors(tone).fg : palette.ink }}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  hero: { fontSize: 26, fontWeight: fontWeight.bold as any, letterSpacing: -0.4, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  reasonBox: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  btnTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
});
