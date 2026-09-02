/**
 * Billing (native) — parity with web /dashboard/billing (read-only half): your
 * license + package, trial/expiry countdown, usage against limits, and payment
 * history. Setting up auto-pay stays on the web dashboard.
 */

import React from "react";
import { View, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Text } from "../../components/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "../../components/states";
import { inr, fmtDate, titleCase } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { useBilling, type UsageMetric } from "./api";

const statusTone = (s?: string | null): string => {
  const v = (s ?? "").toLowerCase();
  if (/(active)/.test(v)) return palette.success;
  if (/(trial)/.test(v)) return palette.info;
  if (/(past_due|suspended)/.test(v)) return palette.warning;
  if (/(expired|cancelled)/.test(v)) return palette.danger;
  return palette.muted;
};

export function Billing() {
  const { data, isLoading, isError, refetch, isRefetching } = useBilling();

  if (isLoading) return <Wrap><LoadingState label="Loading billing…" /></Wrap>;
  if (isError || !data) return <Wrap><ErrorState onRetry={refetch} /></Wrap>;
  if (!data.subscription || !data.package) return <Wrap><EmptyState icon="credit-card" title="No subscription" message="No active subscription on this workspace." /></Wrap>;

  const { subscription: sub, package: pkg, usage, events, computed } = data;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Billing" subtitle="License, plan & usage" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {computed.isTrial && computed.daysLeft != null && (
          <View style={[styles.banner, { borderColor: computed.daysLeft <= 14 ? palette.warning : palette.info, backgroundColor: computed.daysLeft <= 14 ? palette.warningBg : palette.infoBg }]}>
            <Feather name="clock" size={16} color={computed.daysLeft <= 14 ? palette.warning : palette.info} />
            <Text variant="caption" style={{ flex: 1, color: palette.ink }}>
              {computed.daysLeft > 0 ? `Your trial ends in ${computed.daysLeft} day${computed.daysLeft === 1 ? "" : "s"}` : "Your trial has ended"}
              {sub.licenseEndAt ? ` · ${fmtDate(sub.licenseEndAt)}` : ""}. Set up auto-pay on the web dashboard to keep access.
            </Text>
          </View>
        )}

        <View style={styles.planCard}>
          <View style={styles.planHead}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: fontWeight.bold as any }}>{pkg.name ?? "Plan"}</Text>
              {pkg.description ? <Text variant="caption" tone="muted">{pkg.description}</Text> : null}
            </View>
            <View style={[styles.badge, { backgroundColor: statusTone(sub.status) + "1A" }]}>
              <Text style={{ fontSize: 12, color: statusTone(sub.status), fontWeight: fontWeight.bold as any }}>{titleCase(sub.status)}</Text>
            </View>
          </View>
          <View style={styles.planMeta}>
            <Meta label="Billing" value={titleCase(sub.billingCycle)} />
            <Meta label="Renews" value={fmtDate(sub.nextRenewalAt)} />
            <Meta label="Auto-pay" value={titleCase(sub.mandateStatus) || "None"} />
          </View>
        </View>

        {usage && (
          <Section title="USAGE" icon="activity">
            <UsageBar label="Team members" m={usage.users} />
            <UsageBar label="Clients" m={usage.investors} />
            <UsageBar label="Storage (GB)" m={usage.storage} />
            <UsageBar label="Messages this month" m={usage.messages} />
          </Section>
        )}

        {events.length > 0 && (
          <Section title="PAYMENT & LICENSE HISTORY" icon="list">
            {events.map((e) => (
              <View key={e.id} style={styles.eventRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }}>{titleCase(e.eventType)}</Text>
                  <Text variant="caption" tone="faint">{fmtDate(e.at)}</Text>
                </View>
                {e.amountPaise ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any }}>{inr(e.amountPaise / 100)}</Text> : null}
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

function UsageBar({ label, m }: { label: string; m: UsageMetric }) {
  const pct = m.pct ?? (m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0);
  const tone = pct >= 90 ? palette.danger : pct >= 75 ? palette.warning : palette.brand;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={styles.barHead}>
        <Text variant="caption" style={{ flex: 1 }}>{label}</Text>
        <Text variant="caption" tone="muted">{m.used}{m.limit != null ? ` / ${m.limit}` : ""}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(2, pct)}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}
function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <View>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.semibold as any }}>{value || "—"}</Text>
    </View>
  );
}
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <View style={styles.secLabel}>
        <Feather name={icon as any} size={13} color={palette.muted} />
        <Text variant="label" tone="muted" style={{ letterSpacing: 0.6 }}>{title}</Text>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}
function Wrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}><ScreenHeader title="Billing" />{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  planCard: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: spacing.lg },
  planHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  planMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.line },
  secLabel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md },
  barHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: palette.lineSoft },
});
