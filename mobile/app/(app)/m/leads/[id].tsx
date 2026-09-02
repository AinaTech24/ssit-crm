/**
 * Lead detail — web parity. Hero (score band, stage, source, owner + stat strip),
 * call/WhatsApp/email, a stage stepper, and 3 tabs (Overview / Details / Activity)
 * with actions: change stage, log activity, add follow-up, convert-to-client,
 * edit, delete. Data from GET /api/leads/[id]/full.
 */

import React, { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Linking, RefreshControl, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { TextField } from "../../../../src/components/ui/TextField";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { DateField } from "../../../../src/components/form/DateField";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { Section, FieldRow, Empty } from "../../../../src/features/investors/detail/primitives";
import { useLeadFull, useUpdateLeadStage, useLogActivity, useConvertLead, useDeleteLead, LEAD_STAGES, stageMeta, canonicalStage } from "../../../../src/features/leads/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { QuickCommsSheet } from "../../../../src/features/investors/detail/QuickCommsSheet";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { AssignOpsSheet } from "../../../../src/features/tasks/AssignOpsSheet";
import { useRecentlyViewed } from "../../../../src/state/recentlyViewed";
import { inr, initials, fmtDate, titleCase, timeAgo } from "../../../../src/lib/format";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { useBrand } from "../../../../src/theme/brand";

type Tab = "overview" | "details" | "activity";
const TABS = [{ key: "overview", label: "Overview" }, { key: "details", label: "Details" }, { key: "activity", label: "Activity" }];
const BAND_TONE: Record<string, string> = { hot: palette.danger, warm: palette.warning, cold: palette.muted };
const SEGMENTS = [{ key: "Retail", label: "Retail" }, { key: "Affluent", label: "Affluent" }, { key: "HNI", label: "HNI" }, { key: "NRI", label: "NRI" }, { key: "Corporate", label: "Corporate" }];
const ACTIVITY_TYPES = [{ key: "note", label: "Note" }, { key: "call", label: "Call" }, { key: "meeting", label: "Meeting" }, { key: "email", label: "Email" }, { key: "whatsapp", label: "WhatsApp" }];
const waNumber = (p?: string | null) => (p ? p.replace(/[^\d]/g, "").replace(/^0+/, "") : "");
const toneColor = (t?: string) => (t === "success" ? palette.success : t === "warning" ? palette.warning : t === "danger" ? palette.danger : t === "violet" ? palette.violet : t === "info" ? palette.info : palette.muted);

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { brand } = useBrand();
  const { data: d, isLoading, isError, refetch, isRefetching } = useLeadFull(id);
  const stageMut = useUpdateLeadStage(id!);
  const logAct = useLogActivity(id!);
  const convert = useConvertLead(id!);
  const del = useDeleteLead();
  const [tab, setTab] = useState<Tab>("overview");
  const [actions, setActions] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostFor, setLostFor] = useState<string | null>(null);

  useEffect(() => {
    const ld = (d as any)?.lead;
    if (ld?.id) useRecentlyViewed.getState().add({ type: "lead", id: ld.id, name: ld.name });
  }, [(d as any)?.lead?.id]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Lead" /><LoadingState label="Loading lead…" /></View>;
  if (isError || !d?.lead) return <View style={styles.screen}><ScreenHeader title="Lead" /><ErrorState onRetry={refetch} /></View>;

  const l = d.lead;
  const converted = !!l.convertedAt;
  const meta = stageMeta(l.stage);
  const phone = l.phone as string | null;
  const email = l.email as string | null;
  const amount = l.intendedAmount ?? l.expectedBusinessAmount;
  const stats = d.stats ?? {};

  const pickStage = (key: string) => {
    setStageOpen(false);
    if (key === "won_lead") { setConvertOpen(true); return; }
    if (key === "not_qualified") { setLostFor(key); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    stageMut.mutate({ stage: key });
  };
  const doDelete = () => {
    setActions(false);
    confirmDelete({ title: `Delete ${l.name}?`, message: "The lead is archived and hidden from the pipeline.", confirmLabel: "Delete" }, () => del.mutate(id!, { onSuccess: () => router.back() }));
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={l.name ?? "Lead"} right={<Pressable onPress={() => setActions(true)} hitSlop={10}><Feather name="more-vertical" size={20} color={palette.ink} /></Pressable>} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* Hero */}
        <View style={[styles.hero, { borderColor: brand }]}>
          <View style={styles.heroTop}>
            <View style={[styles.avatar, { backgroundColor: palette.brandLight }]}>
              <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 18 }}>{initials(l.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeRow}>
                {l.scoreBand ? <Badge label={String(l.scoreBand).toUpperCase()} tone={BAND_TONE[l.scoreBand] ?? palette.muted} /> : null}
                {converted ? <Badge label="Converted" tone={palette.success} /> : meta ? <Badge label={meta.label} tone={toneColor(meta.tone)} /> : null}
              </View>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {titleCase(l.source) || "—"}{l.city ? ` · ${l.city}` : ""}{d.owner?.name ? ` · RM ${d.owner.name}` : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text variant="caption" tone="faint">Intended</Text>
              <Text variant="subtitle">{inr(amount)}</Text>
            </View>
          </View>

          {/* Stat strip */}
          <View style={styles.stats}>
            <Stat label="Score" value={String(l.leadScore ?? 0)} />
            <Stat label="Days" value={String(stats.daysAsLead ?? 0)} />
            <Stat label="Messages" value={String(stats.messages ?? 0)} />
            <Stat label="Open tasks" value={String(stats.openTasks ?? 0)} />
          </View>

          {/* Contact + convert */}
          <View style={styles.contactRow}>
            <ContactBtn icon="phone" label="Call" disabled={!phone} onPress={() => phone && startCall({ subjectType: "lead", subjectId: id!, name: l.name ?? "Lead", phone })} />
            <ContactBtn icon="message-circle" label="WhatsApp" disabled={!phone} onPress={() => phone && openWhatsApp({ phone, subjectType: "lead", subjectId: id!, name: l.name })} />
            <ContactBtn icon="mail" label="Email" disabled={!email} onPress={() => email && Linking.openURL(`mailto:${email}`)} />
          </View>
          {!converted && (
            <Button label="Convert to client" onPress={() => setConvertOpen(true)} full icon={<Feather name="user-check" size={15} color="#fff" />} style={{ marginTop: spacing.sm }} />
          )}
          {converted && l.convertedInvestorId && (
            <Button label="Open client" variant="secondary" onPress={() => router.replace(`/m/investors/${l.convertedInvestorId}` as any)} full icon={<Feather name="arrow-right" size={15} color={palette.ink} />} style={{ marginTop: spacing.sm }} />
          )}
        </View>

        {/* Sticky tabs */}
        <View style={styles.tabBar}><Segmented<Tab> options={TABS as any} value={tab} onChange={setTab} /></View>

        <Animated.View key={tab} entering={FadeIn.duration(200)}>
          {tab === "overview" ? <Overview d={d} converted={converted} onChangeStage={() => setStageOpen(true)} onLog={() => setActivityOpen(true)} />
            : tab === "details" ? <Details l={l} owner={d.owner} />
            : <Activity d={d} />}
        </Animated.View>
      </ScrollView>

      {/* Actions */}
      <BottomSheet visible={actions} onClose={() => setActions(false)} title={l.name}>
        {!converted && <Button label="Change stage" variant="secondary" full icon={<Feather name="git-branch" size={15} color={palette.ink} />} onPress={() => { setActions(false); setStageOpen(true); }} style={{ marginBottom: spacing.sm }} />}
        <Button label="Log activity" variant="secondary" full icon={<Feather name="edit-3" size={15} color={palette.ink} />} onPress={() => { setActions(false); setActivityOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Quick comms" variant="secondary" full icon={<Feather name="send" size={15} color={palette.ink} />} onPress={() => { setActions(false); setCommsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Send a form" variant="secondary" full icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => { setActions(false); setFormOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Assign to team" variant="secondary" full icon={<Feather name="users" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOpsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Edit lead" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { setActions(false); router.push(`/m/leads/new?editId=${id}` as any); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Delete lead" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={doDelete} />
      </BottomSheet>

      <QuickCommsSheet id={id!} visible={commsOpen} onClose={() => setCommsOpen(false)} subject="lead" />
      <SendFormSheet visible={formOpen} onClose={() => setFormOpen(false)} subjectType="lead" subjectId={id!} name={l.name} />
      <AssignOpsSheet visible={opsOpen} onClose={() => setOpsOpen(false)} subjectType="lead" subjectId={id!} subjectName={l.name} />

      {/* Stage picker */}
      <BottomSheet visible={stageOpen} onClose={() => setStageOpen(false)} title="Change stage">
        {LEAD_STAGES.map((s) => {
          const active = canonicalStage(l.stage) === s.key;
          return (
            <Pressable key={s.key} style={styles.stageRow} onPress={() => pickStage(s.key)}>
              <View style={[styles.colDot, { backgroundColor: toneColor(s.tone) }]} />
              <Text style={{ flex: 1, fontWeight: (active ? fontWeight.semibold : fontWeight.regular) as any, color: active ? palette.brand : palette.ink }}>{s.label}</Text>
              {active ? <Feather name="check" size={16} color={palette.brand} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>

      {/* Lost reason */}
      <LostReasonSheet visible={!!lostFor} onClose={() => setLostFor(null)} pending={stageMut.isPending} onSubmit={(reason) => { stageMut.mutate({ stage: "not_qualified", lostReason: reason }, { onSuccess: () => setLostFor(null) }); }} />

      {/* Log activity */}
      <LogActivitySheet visible={activityOpen} onClose={() => setActivityOpen(false)} pending={logAct.isPending} onSubmit={(v) => logAct.mutate(v, { onSuccess: () => setActivityOpen(false) })} />

      {/* Convert */}
      <ConvertSheet visible={convertOpen} onClose={() => setConvertOpen(false)} pending={convert.isPending} defaultPan={l.pan} error={(convert.error as any)?.message}
        onSubmit={(v) => convert.mutate(v, { onSuccess: (r) => { setConvertOpen(false); if (r?.investorId) router.replace(`/m/investors/${r.investorId}` as any); } })} />
    </View>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function Overview({ d, converted, onChangeStage, onLog }: { d: any; converted: boolean; onChangeStage: () => void; onLog: () => void }) {
  const curIdx = LEAD_STAGES.findIndex((s) => s.key === canonicalStage(d.lead.stage));
  return (
    <View>
      <Section title="Pipeline stage" icon="git-branch" right={!converted ? <Text variant="caption" tone="brand" onPress={onChangeStage}>Change</Text> : undefined}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
          {LEAD_STAGES.map((s, i) => {
            const done = converted || i < curIdx;
            const active = !converted && i === curIdx;
            return (
              <View key={s.key} style={styles.step}>
                <View style={[styles.node, { backgroundColor: done ? palette.success : active ? palette.brand : palette.surfaceSunken, borderColor: done ? palette.success : active ? palette.brand : palette.line }]}>
                  {done ? <Feather name="check" size={11} color="#fff" /> : <Text style={{ fontSize: 10, color: active ? "#fff" : palette.muted, fontWeight: fontWeight.bold as any }}>{i + 1}</Text>}
                </View>
                <Text variant="caption" tone={active ? "brand" : "faint"} numberOfLines={2} style={styles.stepLabel}>{s.label}</Text>
              </View>
            );
          })}
        </ScrollView>
      </Section>

      {d.lead.convertedInvestorId ? (
        <Section title="Converted" icon="check-circle"><Empty text={`Converted to a client on ${fmtDate(d.lead.convertedAt)}.`} /></Section>
      ) : (
        <Section title="Next step" icon="zap">
          <Text variant="caption" tone="muted">Log a call or meeting to advance this lead, or change the stage manually.</Text>
          <Button label="Log activity" size="sm" variant="secondary" onPress={onLog} style={{ marginTop: spacing.sm, alignSelf: "flex-start" }} icon={<Feather name="edit-3" size={13} color={palette.ink} />} />
        </Section>
      )}
    </View>
  );
}

function Details({ l, owner }: { l: any; owner: any }) {
  return (
    <View>
      <Section title="Lead details" icon="file-text">
        <FieldRow label="Source" value={titleCase(l.source)} />
        <FieldRow label="Campaign" value={l.sourceCampaign} />
        <FieldRow label="Phone" value={l.phone} />
        <FieldRow label="Email" value={l.email} />
        <FieldRow label="Alt phone" value={l.altPhone} />
        <FieldRow label="Alt email" value={l.altEmail} />
        <FieldRow label="City" value={l.city} />
        <FieldRow label="Pincode" value={l.pincode} />
        <FieldRow label="Lead type" value={titleCase(l.leadType)} />
        <FieldRow label="AUM potential" value={titleCase(l.aumPotential)} />
        <FieldRow label="Occupation" value={l.profile?.occupation} />
        <FieldRow label="Expected business" value={l.expectedBusinessAmount != null ? inr(l.expectedBusinessAmount) : (l.intendedAmount ? inr(l.intendedAmount) : null)} />
        <FieldRow label="Score" value={`${l.leadScore ?? 0}${l.scoreBand ? ` · ${titleCase(l.scoreBand)}` : ""}`} />
        <FieldRow label="Owner (RM)" value={owner?.name} />
        <FieldRow label="Referred by" value={l.referredByName} />
        <FieldRow label="Last contact" value={fmtDate(l.lastContactAt)} />
        <FieldRow label="Next follow-up" value={fmtDate(l.nextFollowUpAt)} />
      </Section>
      {Array.isArray(l.interestProducts) && l.interestProducts.length > 0 && (
        <Section title="Interested in" icon="tag">
          <View style={styles.tags}>{l.interestProducts.map((p: string) => <View key={p} style={styles.tag}><Text variant="caption" style={{ color: palette.brand }}>{p}</Text></View>)}</View>
        </Section>
      )}
      {l.notes ? <Section title="Notes" icon="edit-3"><Text variant="caption" tone="muted">{l.notes}</Text></Section> : null}
    </View>
  );
}

function Activity({ d }: { d: any }) {
  const entries = parseFollowUpNotes(d.lead.followUpNotes);
  const tasks: any[] = d.tasks ?? [];
  const comms: any[] = d.communications ?? [];
  return (
    <View>
      <Section title="Activity log" icon="clock">
        {entries.length === 0 ? <Empty text="No activity logged yet." /> : entries.map((e, i) => (
          <View key={i} style={styles.logRow}>
            <Text variant="caption" tone="faint">{e.header}</Text>
            <Text variant="caption">{e.body}</Text>
          </View>
        ))}
      </Section>
      <Section title="Tasks" icon="check-square" right={<Text variant="caption" tone="faint">{tasks.length}</Text>}>
        {tasks.length === 0 ? <Empty text="No tasks." /> : tasks.slice(0, 15).map((t) => (
          <View key={t.id} style={styles.row}>
            <Feather name={t.status === "completed" ? "check-circle" : "circle"} size={13} color={t.status === "completed" ? palette.success : palette.faint} />
            <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Text>
            <Text variant="caption" tone="faint">{t.dueAt ? fmtDate(t.dueAt) : titleCase(t.priority)}</Text>
          </View>
        ))}
      </Section>
      <Section title="Communications" icon="message-circle" right={<Text variant="caption" tone="faint">{comms.length}</Text>}>
        {comms.length === 0 ? <Empty text="No messages." /> : comms.slice(0, 15).map((c) => (
          <View key={c.id} style={styles.row}>
            <Feather name={c.channel === "whatsapp" ? "message-circle" : c.channel === "email" ? "mail" : "message-square"} size={13} color={c.direction === "inbound" ? palette.info : palette.brand} />
            <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>{String(c.payload?.rendered?.text ?? c.templateKey ?? titleCase(c.channel)).slice(0, 70)}</Text>
            <Text variant="caption" tone="faint">{timeAgo(c.createdAt)}</Text>
          </View>
        ))}
      </Section>
    </View>
  );
}

function parseFollowUpNotes(raw?: string | null): { header: string; body: string }[] {
  if (!raw) return [];
  return raw.split("\n\n---\n\n").map((block) => {
    const m = block.match(/^\s*\[(.+?)\]\s*([\s\S]*)$/);
    return m ? { header: m[1], body: m[2].trim() } : { header: "", body: block.trim() };
  }).filter((e) => e.body || e.header);
}

// ── Action sheets ─────────────────────────────────────────────────────────────
function LostReasonSheet({ visible, onClose, onSubmit, pending }: { visible: boolean; onClose: () => void; onSubmit: (r: string) => void; pending: boolean }) {
  const REASONS = ["Not interested", "Budget too low", "Chose competitor", "Unreachable", "Wrong number", "Other"];
  const [reason, setReason] = useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Mark not qualified">
      {REASONS.map((r) => (
        <Pressable key={r} style={styles.stageRow} onPress={() => onSubmit(r)}>
          <Text style={{ flex: 1 }}>{r}</Text>
        </Pressable>
      ))}
      <View style={{ height: spacing.sm }} />
      <TextField label="Custom reason" value={reason} onChangeText={setReason} placeholder="Type a reason" />
      <Button label="Mark not qualified" full loading={pending} disabled={!reason.trim()} onPress={() => onSubmit(reason.trim())} style={{ marginTop: spacing.sm }} />
    </BottomSheet>
  );
}

function LogActivitySheet({ visible, onClose, onSubmit, pending }: { visible: boolean; onClose: () => void; onSubmit: (v: { note: string; activityType: string; nextFollowUpAt?: string }) => void; pending: boolean }) {
  const [note, setNote] = useState("");
  const [type, setType] = useState("note");
  const [next, setNext] = useState("");
  const submit = () => { if (!note.trim()) return; onSubmit({ note: note.trim(), activityType: type, nextFollowUpAt: next ? new Date(next + "T09:00:00").toISOString() : undefined }); setNote(""); setNext(""); setType("note"); };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Log activity">
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><Segmented<string> options={ACTIVITY_TYPES} value={type} onChange={setType} /></ScrollView>
      <View style={{ height: spacing.md }} />
      <TextField label="Note" value={note} onChangeText={setNote} placeholder="What happened?" multiline required />
      <DateField label="Next follow-up (optional)" value={next} onChange={setNext} />
      <View style={{ height: spacing.md }} />
      <Button label="Save activity" full loading={pending} onPress={submit} />
    </BottomSheet>
  );
}

function ConvertSheet({ visible, onClose, onSubmit, pending, defaultPan, error }: { visible: boolean; onClose: () => void; onSubmit: (v: { pan?: string; segmentTag: string; investorCategory: string }) => void; pending: boolean; defaultPan?: string | null; error?: string }) {
  const [pan, setPan] = useState(defaultPan ?? "");
  const [segment, setSegment] = useState("Retail");
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Convert to client">
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>Creates a client from this lead and carries over risk profile, proposals, meetings and documents.</Text>
      <TextField label="PAN (optional)" value={pan} onChangeText={(v) => setPan(v.toUpperCase())} placeholder="ABCDE1234F" autoCapitalize="characters" />
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Segment</Text>
      <Segmented<string> options={SEGMENTS} value={segment} onChange={setSegment} />
      {error ? <Text variant="caption" style={{ color: palette.danger, marginTop: spacing.sm }}>{error}</Text> : null}
      <View style={{ height: spacing.md }} />
      <Button label="Convert to client" full loading={pending} onPress={() => onSubmit({ pan: pan.trim() || undefined, segmentTag: segment, investorCategory: "individual" })} icon={<Feather name="user-check" size={15} color="#fff" />} />
    </BottomSheet>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────
function Badge({ label, tone }: { label: string; tone: string }) {
  return <View style={[styles.badge, { backgroundColor: tone + "1A" }]}><Text style={{ fontSize: 11, color: tone, fontWeight: fontWeight.semibold as any }}>{label}</Text></View>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={{ fontWeight: fontWeight.bold as any }}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function ContactBtn({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.contactBtn, disabled && { opacity: 0.4 }]}>
      <Feather name={icon as any} size={16} color={palette.brand} />
      <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.medium as any }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  hero: { backgroundColor: palette.surface, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  heroTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  badgeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", alignItems: "center" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  stat: { flex: 1 },
  contactRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: palette.brandLight, borderRadius: radius.md, paddingVertical: spacing.sm },
  tabBar: { backgroundColor: palette.surfaceAlt, paddingVertical: spacing.sm },
  step: { width: 74, alignItems: "center", gap: 4 },
  node: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepLabel: { textAlign: "center", fontSize: 10 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  logRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft, gap: 2 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { backgroundColor: palette.brandLight, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
});
