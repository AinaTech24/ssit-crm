/**
 * Engagement tab — family snapshot, the related lists (holdings / SIPs / goals /
 * tasks / service requests), the consent matrix, and the communications log
 * (emails + WhatsApp). Documents upload, gifts budget and the onboarding
 * blueprint bar are web-only interactive extras (not yet on mobile).
 */

import React from "react";
import { View, Pressable, Alert, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase, timeAgo } from "../../../lib/format";
import { Section, FieldRow, Badge, Empty } from "./primitives";
import { DocumentsSection } from "./DocumentsSection";
import { GiftsSection } from "./GiftsSection";
import { BlueprintBar } from "./BlueprintBar";
import { useSetConsent } from "../api";
import { toast } from "../../../lib/toast";

const CHANNELS = ["whatsapp", "email", "sms"] as const;
const SCOPES = ["transactional", "marketing"] as const;

export function EngagementTab({ d, id }: { d: any; id: string }) {
  const folios: any[] = d.folios ?? [];
  const sips: any[] = d.sips ?? [];
  const goals: any[] = d.goals ?? [];
  const openTasks: any[] = (d.tasks ?? []).filter((t: any) => t.status !== "completed");
  const srs: any[] = d.serviceRequests ?? [];
  const comms: any[] = d.communications ?? [];

  // Consent matrix lookup: consents[channel][scope] = granted?
  const consentMap: Record<string, Record<string, boolean>> = {};
  for (const c of d.consents ?? []) {
    const ch = String(c.channel ?? "").toLowerCase();
    const sc = String(c.scope ?? "").toLowerCase();
    const granted = c.status === "granted" || c.granted === true || c.grantedAt != null;
    (consentMap[ch] ??= {})[sc] = granted;
  }

  const setConsent = useSetConsent(id);
  const clientName = d.investor?.name ?? "this client";

  /**
   * Recording consent is a compliance assertion on the RM's part, not a UI
   * toggle — so it always confirms, and the wording says plainly what is being
   * asserted and who it's about.
   */
  const toggleConsent = (channel: string, scope: string, currentlyGranted: boolean) => {
    const chLabel = titleCase(channel);
    const scLabel = scope === "marketing" ? "marketing" : "transactional";
    const next = currentlyGranted ? "revoked" : "granted";
    Alert.alert(
      currentlyGranted ? `Revoke ${chLabel} consent?` : `Record ${chLabel} consent?`,
      currentlyGranted
        ? `${clientName} no longer wants ${scLabel} messages on ${chLabel}. Sends will be blocked.`
        : `Confirm ${clientName} has agreed to receive ${scLabel} messages on ${chLabel}. This is recorded as your assertion and is audited.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: currentlyGranted ? "Revoke" : "Confirm",
          style: currentlyGranted ? "destructive" : "default",
          onPress: () =>
            setConsent.mutate(
              { channel: channel as any, scope: scope as any, status: next as any },
              {
                onSuccess: () => toast.success(currentlyGranted ? `${chLabel} consent revoked` : `${chLabel} consent recorded`),
                onError: (e: any) => toast.error(e?.body?.error || "Couldn't save consent"),
              }
            ),
        },
      ]
    );
  };

  return (
    <View>
      {/* Family */}
      <Section title="Family snapshot" icon="users">
        {d.family ? (
          <>
            <FieldRow label="Family" value={d.family.familyName ?? d.family.headName} />
            <FieldRow label="Code" value={d.family.familyCode} />
            <FieldRow label="Role" value={titleCase(d.investor?.familyRole)} />
          </>
        ) : <Empty text="Not part of a family group." />}
      </Section>

      {/* Onboarding blueprint */}
      <BlueprintBar id={id} />

      {/* Documents (uploadable) */}
      <DocumentsSection id={id} clientName={d.investor?.name} />

      {/* Birthday gifts & budget */}
      <GiftsSection id={id} />

      {/* Holdings */}
      <Section title="Holdings" icon="briefcase" right={<Text variant="caption" tone="faint">{folios.length}</Text>}>
        {folios.length === 0 ? <Empty text="No folios." /> : folios.slice(0, 12).map((f, i) => (
          <View key={f.id ?? i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{f.schemeName ?? "Scheme"}</Text>
              <Text variant="caption" tone="faint" numberOfLines={1}>{[f.amcName, f.folioNumber].filter(Boolean).join(" · ")}</Text>
            </View>
            <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any }}>{inr(f.currentValue ?? f.costBasis)}</Text>
          </View>
        ))}
      </Section>

      {/* SIPs */}
      <Section title="Active SIPs" icon="repeat" right={<Text variant="caption" tone="faint">{sips.length}</Text>}>
        {sips.length === 0 ? <Empty text="No SIPs." /> : sips.slice(0, 12).map((s, i) => (
          <View key={s.id ?? i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{s.schemeName ?? s.schemeCode ?? "SIP"}</Text>
              <Text variant="caption" tone="faint">{titleCase(s.frequency)} · {titleCase(s.status)}</Text>
            </View>
            <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any }}>{inr(s.amount)}</Text>
          </View>
        ))}
      </Section>

      {/* Goals */}
      <Section title="Goals" icon="target" right={<Text variant="caption" tone="faint">{goals.length}</Text>}>
        {goals.length === 0 ? <Empty text="No goals." /> : goals.map((g, i) => {
          const pct = Number(g.progressPct ?? 0);
          return (
            <View key={g.id ?? i} style={{ marginBottom: spacing.sm }}>
              <View style={styles.goalHead}>
                <Text variant="caption" style={{ flex: 1, fontWeight: fontWeight.medium as any }} numberOfLines={1}>{g.name ?? titleCase(g.category)}</Text>
                <Text variant="caption" tone="muted">{inr(g.currentValue)} / {inr(g.targetAmount)}</Text>
              </View>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} /></View>
            </View>
          );
        })}
      </Section>

      {/* Open tasks */}
      <Section title="Open tasks" icon="check-square" right={<Text variant="caption" tone="faint">{openTasks.length}</Text>}>
        {openTasks.length === 0 ? <Empty text="No open tasks." /> : openTasks.slice(0, 10).map((t, i) => (
          <View key={t.id ?? i} style={styles.row}>
            <Feather name="circle" size={12} color={palette.faint} />
            <Text variant="caption" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Text>
            <Text variant="caption" tone="faint">{t.dueAt ? fmtDate(t.dueAt) : titleCase(t.priority)}</Text>
          </View>
        ))}
      </Section>

      {/* Service requests */}
      <Section title="Service requests" icon="life-buoy" right={<Text variant="caption" tone="faint">{srs.length}</Text>}>
        {srs.length === 0 ? <Empty text="No service requests." /> : srs.slice(0, 10).map((s, i) => (
          <View key={s.id ?? i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{s.subject ?? s.ticketNo}</Text>
              <Text variant="caption" tone="faint">{s.ticketNo}</Text>
            </View>
            <Text variant="caption" tone="muted">{titleCase(s.status)}</Text>
          </View>
        ))}
      </Section>

      {/* Consent matrix — tappable. Without consent the pipeline silently skips
          every send, and the RM with the client is the only one who can fix that. */}
      <Section title="Consent" icon="shield">
        <View style={styles.consentHead}>
          <Text variant="caption" tone="muted" style={{ flex: 1 }} />
          {SCOPES.map((sc) => <Text key={sc} variant="caption" tone="muted" style={styles.consentCell}>{titleCase(sc)}</Text>)}
        </View>
        {CHANNELS.map((ch) => (
          <View key={ch} style={styles.consentRow}>
            <Text variant="caption" style={{ flex: 1, fontWeight: fontWeight.medium as any }}>{titleCase(ch)}</Text>
            {SCOPES.map((sc) => {
              const granted = !!consentMap[ch]?.[sc];
              return (
                <Pressable
                  key={sc}
                  style={styles.consentCell}
                  onPress={() => toggleConsent(ch, sc, granted)}
                  disabled={setConsent.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`${titleCase(ch)} ${sc} consent, ${granted ? "granted" : "not granted"}. Tap to change.`}
                >
                  {granted ? (
                    <Feather name="check-circle" size={16} color={palette.success} />
                  ) : (
                    <Feather name="plus-circle" size={16} color={palette.faint} />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
          Tap to record what the client agreed to. Messages are blocked without it.
        </Text>
      </Section>

      {/* Communications */}
      <Section title="Communications" icon="message-circle" right={<Text variant="caption" tone="faint">{comms.length}</Text>}>
        {comms.length === 0 ? <Empty text="No messages yet." /> : comms.slice(0, 15).map((c, i) => {
          const preview = c.payload?.rendered?.text ?? c.inboundContent?.text ?? c.templateKey ?? "";
          return (
            <View key={c.id ?? i} style={styles.commRow}>
              <Feather name={c.channel === "whatsapp" ? "message-circle" : c.channel === "email" ? "mail" : "message-square"} size={13} color={c.direction === "inbound" ? palette.info : palette.brand} />
              <View style={{ flex: 1 }}>
                <Text variant="caption" numberOfLines={1}>{String(preview).slice(0, 80) || titleCase(c.channel)}</Text>
                <Text variant="caption" tone="faint">{titleCase(c.status)} · {timeAgo(c.createdAt)}</Text>
              </View>
            </View>
          );
        })}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  goalHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 4 },
  track: { height: 7, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  fill: { height: 7, borderRadius: 4, backgroundColor: palette.brand },
  consentHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs },
  consentRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  consentCell: { width: 90, alignItems: "center" },
  commRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
});
