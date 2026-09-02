/**
 * Proposal detail — recipient, KPIs, product line items, cover letter, and the
 * actions an RM takes from the field: add the mandatory suitability note, send
 * over WhatsApp/email (the send endpoint gates on suitability + consent), and
 * mark the outcome. Delete is a soft-reject, matching web.
 */

import React from "react";
import { View, Pressable, Linking, StyleSheet, ActivityIndicator } from "react-native";
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
  useProposal, useUpdateProposal, useSendProposal, useDeleteProposal,
  lineTitle, lineAmount, num, LINE_KIND_LABEL, type ProposalLine, type ProposalStatus,
} from "../../../../src/features/proposals/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const STATUS_TONE: Record<ProposalStatus, Tone> = {
  draft: "neutral", ready: "info", sent: "info", viewed: "brand", accepted: "success", rejected: "danger", expired: "warning",
};

export default function ProposalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pid = String(id);
  const { data: p, isLoading } = useProposal(pid);
  const update = useUpdateProposal(pid);
  const send = useSendProposal(pid);
  const del = useDeleteProposal();

  const [note, setNote] = React.useState<string | null>(null);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const suitability = note ?? p?.suitabilityNote ?? "";

  if (isLoading || !p) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Proposal" />
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
      </View>
    );
  }

  const invest = num(p.totalInvestment);
  const corpus = num(p.expectedCorpus);
  const canSend = p.status !== "accepted" && p.status !== "rejected";
  const sendable = suitability.trim().length > 0;

  const doSend = (channel: "email" | "whatsapp") => {
    if (channel === "whatsapp" && !p.recipientPhone) return toast.error("No phone number on this recipient");
    if (channel === "email" && !p.recipientEmail) return toast.error("No email on this recipient");
    send.mutate(channel, {
      onSuccess: (r) => {
        if (r.waUrl) Linking.openURL(r.waUrl).catch(() => {});
        toast.success(channel === "whatsapp" ? "Opening WhatsApp…" : "Proposal emailed");
      },
      onError: (e: any) => {
        const field = e?.body?.field;
        if (field === "suitabilityNote") { toast.error("Add a suitability note first"); setNoteOpen(true); }
        else toast.error(e?.body?.error || "Couldn't send — check consent & suitability");
      },
    });
  };

  const setStatus = (status: ProposalStatus, label: string) =>
    update.mutate({ status }, { onSuccess: () => toast.success(label) });

  const saveNote = () => {
    update.mutate({ suitabilityNote: suitability } as any, { onSuccess: () => { toast.success("Suitability note saved"); setNoteOpen(false); } });
  };

  const remove = () => {
    confirmDelete({ title: "Delete proposal?", message: "This removes it from your list.", confirmLabel: "Delete" }, () => {
      del.mutate(pid, { onSuccess: () => { toast.success("Proposal deleted"); router.back(); } });
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={p.proposalNumber} subtitle={titleCase(p.type.replace(/_/g, " "))} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Hero */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <Text variant="title" style={{ flex: 1 }}>{p.title}</Text>
            <StatusPill label={titleCase(p.status)} tone={STATUS_TONE[p.status]} size="sm" />
          </View>
          <Text variant="body" tone="muted" style={{ marginTop: 4 }}>{p.recipientName}</Text>
          {p.validUntil ? <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>Valid until {fmtDate(p.validUntil)}</Text> : null}
          <View style={styles.kpis}>
            <Kpi label="Investment" value={invest > 0 ? inr(invest) : "—"} />
            <View style={styles.vline} />
            <Kpi label="Proj. corpus" value={corpus > 0 ? inr(corpus) : "—"} />
            <View style={styles.vline} />
            <Kpi label="Items" value={String(p.products.length)} />
          </View>
        </Card>

        {/* Products */}
        <SectionLabel text={`PRODUCTS (${p.products.length})`} />
        <Card flat style={{ padding: 0, overflow: "hidden" }}>
          {p.products.length === 0 ? (
            <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">No product line items.</Text></View>
          ) : (
            p.products.map((l, i) => <ProductRow key={i} line={l} last={i === p.products.length - 1} />)
          )}
        </Card>

        {/* Cover letter */}
        {p.coverLetter ? (
          <>
            <SectionLabel text="COVER LETTER" />
            <Card flat><Text variant="body" style={{ color: palette.ink, lineHeight: 21 }}>{p.coverLetter}</Text></Card>
          </>
        ) : null}

        {/* Suitability */}
        <SectionLabel text="SUITABILITY NOTE" />
        <Pressable onPress={() => setNoteOpen(true)}>
          <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Feather name={sendable ? "check-circle" : "alert-circle"} size={18} color={sendable ? toneColors("success").fg : toneColors("warning").fg} />
            <Text variant="body" style={{ flex: 1, color: sendable ? palette.ink : palette.muted }} numberOfLines={2}>
              {sendable ? suitability : "Required before sending — tap to add why this suits the client."}
            </Text>
            <Feather name="edit-2" size={14} color={palette.faint} />
          </Card>
        </Pressable>

        {/* Actions */}
        {canSend ? (
          <View style={styles.sendRow}>
            <Pressable style={[styles.sendBtn, { backgroundColor: palette.success }]} onPress={() => doSend("whatsapp")} disabled={send.isPending}>
              {send.isPending ? <ActivityIndicator color={palette.white} size="small" /> : <Feather name="message-circle" size={16} color={palette.white} />}
              <Text style={styles.sendTxt}>WhatsApp</Text>
            </Pressable>
            <Pressable style={[styles.sendBtn, { backgroundColor: palette.brand }]} onPress={() => doSend("email")} disabled={send.isPending}>
              <Feather name="mail" size={16} color={palette.white} />
              <Text style={styles.sendTxt}>Email</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Outcome */}
        {(p.status === "sent" || p.status === "viewed") ? (
          <View style={styles.sendRow}>
            <Pressable style={[styles.outBtn, { borderColor: toneColors("success").fg }]} onPress={() => setStatus("accepted", "Marked accepted")}>
              <Text style={{ color: toneColors("success").fg, fontWeight: fontWeight.semibold as any }}>Mark accepted</Text>
            </Pressable>
            <Pressable style={[styles.outBtn, { borderColor: toneColors("danger").fg }]} onPress={() => setStatus("rejected", "Marked rejected")}>
              <Text style={{ color: toneColors("danger").fg, fontWeight: fontWeight.semibold as any }}>Mark rejected</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={remove} style={{ alignSelf: "center", marginTop: spacing.xl, padding: spacing.md }}>
          <Text variant="caption" style={{ color: toneColors("danger").fg }}>Delete proposal</Text>
        </Pressable>
      </Screen>

      {/* Suitability editor */}
      <BottomSheet visible={noteOpen} onClose={() => setNoteOpen(false)} title="Suitability note">
        <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
          Why is this recommendation suitable for the client's risk profile and goals? Required before sending.
        </Text>
        <TextField label="Note" value={suitability} onChangeText={setNote} multiline placeholder="e.g. Aligned with the client's moderate risk profile and 10-year horizon…" />
        <Pressable style={[styles.sendBtn, { backgroundColor: palette.brand, marginTop: spacing.sm }]} onPress={saveNote} disabled={update.isPending}>
          <Text style={styles.sendTxt}>Save note</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

function ProductRow({ line, last }: { line: ProposalLine; last: boolean }) {
  const amt = lineAmount(line);
  const sub = subFor(line);
  return (
    <View style={[styles.pRow, !last && styles.divider]}>
      <View style={styles.pTag}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any, fontSize: 10 }}>{LINE_KIND_LABEL[line.kind].toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>{lineTitle(line)}</Text>
        {sub ? <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text> : null}
      </View>
      {amt > 0 ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: palette.ink }}>{inr(amt)}</Text> : null}
    </View>
  );
}

function subFor(l: ProposalLine): string {
  if (l.kind === "mf") return [l.amcName, l.monthlyAmount ? `${inr(l.monthlyAmount)}/mo SIP` : null, l.lumpsum ? `${inr(l.lumpsum)} lumpsum` : null].filter(Boolean).join(" · ");
  if (l.kind === "insurance") return [l.insurer, l.policyType ? titleCase(l.policyType) : null, l.sumAssured ? `${inr(l.sumAssured)} cover` : null].filter(Boolean).join(" · ");
  if (l.kind === "pms") return [l.manager, l.proposedAmount ? inr(l.proposedAmount) : null].filter(Boolean).join(" · ");
  if (l.kind === "aif") return [l.manager, l.category?.toUpperCase(), l.proposedAmount ? inr(l.proposedAmount) : null].filter(Boolean).join(" · ");
  return [l.company, l.amount ? inr(l.amount) : null].filter(Boolean).join(" · ");
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 15, fontWeight: fontWeight.bold as any }} numberOfLines={1}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  kpis: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  vline: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: palette.line },
  pRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  pTag: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  sendRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md },
  sendTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
  outBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
});
