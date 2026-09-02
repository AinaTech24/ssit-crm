/**
 * Client 360 detail — web-parity. Pinned hero (avatar + health, PAN, segment/KYC
 * badges, contact + verify pills, AUM/SIP/inflow/XIRR rail), one-tap call /
 * WhatsApp / email, an actions sheet (edit / statement / delete), and the four
 * tabs (Overview / Portfolio / KYC & Profile / Engagement) off GET
 * /api/investors/[id]/full.
 */

import React, { useState, useEffect } from "react";
import { View, ScrollView, Pressable, Image, Linking, RefreshControl, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { OverviewTab } from "../../../../src/features/investors/detail/OverviewTab";
import { PortfolioTab } from "../../../../src/features/investors/detail/PortfolioTab";
import { ProfileTab } from "../../../../src/features/investors/detail/ProfileTab";
import { EngagementTab } from "../../../../src/features/investors/detail/EngagementTab";
import { AiBriefSheet } from "../../../../src/features/investors/detail/AiBriefSheet";
import { QuickCommsSheet } from "../../../../src/features/investors/detail/QuickCommsSheet";
import { OnboardingWizardSheet } from "../../../../src/features/investors/detail/OnboardingWizardSheet";
import { avatarUri, useAvatarHeaders, useUploadAvatar } from "../../../../src/features/investors/detail/subfeatures";
import { useInvestorFull, useVerifyContact, useSendStatement, useDeleteInvestor } from "../../../../src/features/investors/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { inr, initials, fmtDate } from "../../../../src/lib/format";
import { investorStatusBadge, kycBadge } from "../../../../src/lib/status";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";
import { startCall } from "../../../../src/features/activities/callAndLog";
import { openWhatsApp } from "../../../../src/features/activities/whatsapp";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { AssignOpsSheet } from "../../../../src/features/tasks/AssignOpsSheet";
import { useRecentlyViewed } from "../../../../src/state/recentlyViewed";
import { useBrand } from "../../../../src/theme/brand";

type Tab = "overview" | "portfolio" | "profile" | "engagement";
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "portfolio", label: "Portfolio" },
  { key: "profile", label: "KYC & Profile" },
  { key: "engagement", label: "Engagement" },
];
const HEALTH_DOT: Record<string, string> = { green: palette.success, amber: palette.warning, red: palette.danger };
const waNumber = (p?: string | null) => (p ? p.replace(/[^\d]/g, "").replace(/^0+/, "") : "");

export default function InvestorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { brand } = useBrand();
  const { data: d, isLoading, isError, refetch, isRefetching } = useInvestorFull(id);
  const verify = useVerifyContact(id!);
  const statement = useSendStatement(id!);
  const del = useDeleteInvestor();
  const avatar = useUploadAvatar(id!);
  const avatarHeaders = useAvatarHeaders();
  const [tab, setTab] = useState<Tab>("overview");
  const [actions, setActions] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(false);

  useEffect(() => {
    const inv = (d as any)?.investor;
    if (inv?.id) useRecentlyViewed.getState().add({ type: "investor", id: inv.id, name: inv.name });
  }, [(d as any)?.investor?.id]);

  const pickAvatar = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      avatar.mutate({ uri: a.uri, name: a.fileName ?? `avatar-${Date.now()}.jpg`, mime: a.mimeType ?? "image/jpeg", clientName: (d as any)?.investor?.name });
    }
  };

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Client" /><LoadingState label="Loading client…" /></View>;
  if (isError || !d?.investor) return <View style={styles.screen}><ScreenHeader title="Client" /><ErrorState onRetry={refetch} /></View>;

  const i = d.investor;
  const status = investorStatusBadge(i.status);
  const kyc = kycBadge(i.kycStatus);
  const phone = i.phone as string | null;
  const email = i.email as string | null;
  const v = d.valuation ?? {};

  const doDelete = () => {
    setActions(false);
    confirmDelete(
      { title: `Delete ${i.name}?`, message: "The client moves to Trash and can be restored within 30 days.", confirmLabel: "Delete" },
      () => del.mutate(id!, { onSuccess: () => router.back() })
    );
  };
  const sendStatement = (channel: "email" | "whatsapp") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    statement.mutate(channel, {
      onSuccess: (r) => { setActions(false); if (r?.waUrl) Linking.openURL(r.waUrl).catch(() => {}); },
    });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={i.name}
        right={<Pressable onPress={() => setActions(true)} hitSlop={10}><Feather name="more-vertical" size={20} color={palette.ink} /></Pressable>}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* Hero */}
        <View style={[styles.hero, { borderColor: brand }]}>
          <View style={styles.heroTop}>
            <Pressable style={[styles.avatar, { backgroundColor: palette.brandLight }]} onPress={pickAvatar} disabled={avatar.isPending}>
              {i.avatarUrl ? (
                <Image source={{ uri: `${avatarUri(id!)}?t=${i.updatedAt ?? ""}`, headers: avatarHeaders }} style={styles.avatarImg} />
              ) : (
                <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 18 }}>{initials(i.name)}</Text>
              )}
              <View style={styles.camBadge}><Feather name={avatar.isPending ? "loader" : "camera"} size={10} color="#fff" /></View>
              {i.healthBand ? <View style={[styles.dot, { backgroundColor: HEALTH_DOT[i.healthBand] ?? palette.faint }]} /> : null}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="muted">{i.pan ?? "PAN —"}</Text>
              <View style={styles.badgeRow}>
                {i.segmentTag ? <Badge label={i.segmentTag} tone={palette.violet} /> : null}
                <Badge label={status.label} tone={status.tone === "success" ? palette.success : status.tone === "danger" ? palette.danger : palette.muted} />
                <Badge label={kyc.label} tone={kyc.tone === "success" ? palette.success : palette.warning} />
              </View>
              <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
                {i.onboardedAt ? `Onboarded ${fmtDate(i.onboardedAt)}` : ""}{i.address?.city ? ` · ${i.address.city}` : ""}
              </Text>
            </View>
          </View>

          {/* KPI rail */}
          <View style={styles.rail}>
            <Rail label="AUM" value={inr(i.aum)} />
            <Rail label="Active SIP" value={inr(i.activeSipAmount)} />
            <Rail label="Inflow" value={inr(i.lifetimeInflow)} />
            <Rail label="XIRR" value={v.xirr != null ? `${Number(v.xirr).toFixed(1)}%` : "—"} />
          </View>

          {/* Verify pills */}
          <View style={styles.verifyRow}>
            <VerifyPill label="Email" verified={!!i.emailVerifiedAt} onPress={() => email && verify.mutate({ channel: "email", verified: !i.emailVerifiedAt })} disabled={!email || verify.isPending} />
            <VerifyPill label="Phone" verified={!!i.phoneVerifiedAt} onPress={() => phone && verify.mutate({ channel: "phone", verified: !i.phoneVerifiedAt })} disabled={!phone || verify.isPending} />
          </View>

          {/* Contact actions */}
          <View style={styles.contactRow}>
            <ContactBtn icon="phone" label="Call" disabled={!phone} onPress={() => phone && startCall({ subjectType: "investor", subjectId: i.id, name: i.name ?? "Client", phone })} />
            <ContactBtn icon="message-circle" label="WhatsApp" disabled={!phone} onPress={() => phone && openWhatsApp({ phone, subjectType: "investor", subjectId: i.id, name: i.name })} />
            <ContactBtn icon="mail" label="Email" disabled={!email} onPress={() => email && Linking.openURL(`mailto:${email}`)} />
          </View>
        </View>

        {/* Sticky tab bar */}
        <View style={styles.tabBar}>
          <Segmented<Tab> options={TABS as any} value={tab} onChange={setTab} />
        </View>

        <Animated.View key={tab} entering={FadeIn.duration(220)}>
          {tab === "overview" ? <OverviewTab d={d} id={id!} />
            : tab === "portfolio" ? <PortfolioTab d={d} />
            : tab === "profile" ? <ProfileTab d={d} />
            : <EngagementTab d={d} id={id!} />}
        </Animated.View>
      </ScrollView>

      {/* Actions sheet */}
      <BottomSheet visible={actions} onClose={() => setActions(false)} title={i.name}>
        <Button label="Edit client" variant="secondary" full icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => { setActions(false); router.push(`/m/investors/new?editId=${id}` as any); }} style={{ marginBottom: spacing.sm }} />
        <Button label="AI client brief" variant="secondary" full icon={<Feather name="zap" size={15} color={palette.ink} />} onPress={() => { setActions(false); setAiOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Quick comms" variant="secondary" full icon={<Feather name="send" size={15} color={palette.ink} />} onPress={() => { setActions(false); setCommsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Send a form" variant="secondary" full icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => { setActions(false); setFormOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Assign to team" variant="secondary" full icon={<Feather name="users" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOpsOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Onboarding wizard" variant="secondary" full icon={<Feather name="check-square" size={15} color={palette.ink} />} onPress={() => { setActions(false); setOnboardOpen(true); }} style={{ marginBottom: spacing.sm }} />
        <Button label="Email statement" variant="secondary" full loading={statement.isPending} icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => sendStatement("email")} style={{ marginBottom: spacing.sm }} />
        <Button label="WhatsApp statement" variant="secondary" full loading={statement.isPending} icon={<Feather name="message-circle" size={15} color={palette.ink} />} onPress={() => sendStatement("whatsapp")} style={{ marginBottom: spacing.sm }} />
        <Button label="Delete client" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={15} color="#fff" />} onPress={doDelete} />
      </BottomSheet>

      <AiBriefSheet id={id!} visible={aiOpen} onClose={() => setAiOpen(false)} phone={phone} />
      <QuickCommsSheet id={id!} visible={commsOpen} onClose={() => setCommsOpen(false)} />
      <OnboardingWizardSheet id={id!} visible={onboardOpen} onClose={() => setOnboardOpen(false)} investor={i} />
      <SendFormSheet visible={formOpen} onClose={() => setFormOpen(false)} subjectType="investor" subjectId={id!} name={i.name} />
      <AssignOpsSheet visible={opsOpen} onClose={() => setOpsOpen(false)} subjectType="investor" subjectId={id!} subjectName={i.name} />
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return <View style={[styles.badge, { backgroundColor: tone + "1A" }]}><Text style={{ fontSize: 11, color: tone, fontWeight: fontWeight.semibold as any }}>{label}</Text></View>;
}
function Rail({ label, value }: { label: string; value: string }) {
  return <View style={styles.railCell}><Text variant="caption" tone="muted">{label}</Text><Text style={{ fontWeight: fontWeight.bold as any }} numberOfLines={1}>{value}</Text></View>;
}
function VerifyPill({ label, verified, onPress, disabled }: { label: string; verified: boolean; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.verifyPill, verified && { backgroundColor: palette.successBg, borderColor: palette.success }, disabled && { opacity: 0.5 }]}>
      <Feather name={verified ? "check-circle" : "shield"} size={12} color={verified ? palette.success : palette.muted} />
      <Text style={{ fontSize: 11, color: verified ? palette.success : palette.muted, fontWeight: fontWeight.medium as any }}>{label}{verified ? " verified" : ""}</Text>
    </Pressable>
  );
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
  heroTop: { flexDirection: "row", gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", overflow: "visible" },
  avatarImg: { width: 52, height: 52, borderRadius: 26 },
  camBadge: { position: "absolute", right: -2, top: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.surface },
  dot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: palette.surface },
  badgeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 4, alignItems: "center" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  rail: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  railCell: { flex: 1 },
  verifyRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  verifyPill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  contactRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  contactBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: palette.brandLight, borderRadius: radius.md, paddingVertical: spacing.sm },
  tabBar: { backgroundColor: palette.surfaceAlt, paddingVertical: spacing.sm },
});
