/**
 * WhatsApp connection — parity with web /dashboard/settings/whatsapp (read-only
 * status). Shows the tenant's WhatsApp number(s) and Meta template approval
 * counts. Provisioning/connection is SSIT-managed. GET /api/settings/whatsapp-status.
 */

import React from "react";
import { View, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { titleCase } from "../../lib/format";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useWhatsAppStatus } from "./api";

export function WhatsAppSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useWhatsAppStatus();

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="WhatsApp connection" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="WhatsApp connection" /><ErrorState onRetry={refetch} /></View>;

  const numbers = data.numbers ?? [];
  const t = data.templates ?? { approved: 0, pending: 0, rejected: 0 };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="WhatsApp connection" subtitle="Number & template approvals" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Card flat style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="info" size={15} color={palette.muted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Your WhatsApp number is provisioned by SSIT. Template approvals come from Meta.
          </Text>
        </Card>

        <Text style={styles.section}>NUMBERS</Text>
        {numbers.length === 0 ? (
          <Card flat><Text variant="caption" tone="muted">No WhatsApp number connected yet — contact SSIT to provision one.</Text></Card>
        ) : (
          <Card flat style={{ padding: 0 }}>
            {numbers.map((n: any, i: number) => (
              <View key={i} style={[styles.row, i < numbers.length - 1 && styles.divider]}>
                <View style={styles.iconWrap}><Feather name="message-circle" size={16} color={palette.success} /></View>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{n.display_name || n.phone_number || "—"}</Text>
                  {n.display_name && n.phone_number ? <Text variant="caption" tone="muted">{n.phone_number}</Text> : null}
                </View>
                {n.status ? <StatusPill label={titleCase(n.status)} tone={String(n.status).toLowerCase() === "active" ? "success" : "neutral"} dot={false} size="sm" /> : null}
              </View>
            ))}
          </Card>
        )}

        <Text style={styles.section}>TEMPLATE APPROVALS (META)</Text>
        <View style={styles.tiles}>
          <Tile label="Approved" value={t.approved} color={palette.success} />
          <Tile label="Pending" value={t.pending} color={palette.warning} />
          <Tile label="Rejected" value={t.rejected} color={palette.danger} />
        </View>
      </ScrollView>
    </View>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.tile}>
      <Text style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold as any, color }}>{value}</Text>
      <Text variant="caption" tone="muted">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
});
