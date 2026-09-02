/**
 * InvestorKpiStrip — the 8-tile Clients KPI strip (mobile parity with the web
 * InvestorKpiStrip): Total clients, Total AUM, Monthly SIP book, A-tier, Reviews
 * due, KYC expiring 30d, Nominee missing, Dormant. Horizontally scrollable.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { inr } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { useInvestorKpis } from "./api";

function Tile({ icon, tone, label, value, sub }: { icon: string; tone: string; label: string; value: string; sub: string }) {
  return (
    <View style={styles.tile}>
      <View style={styles.head}>
        <Feather name={icon as any} size={13} color={tone} />
        <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontSize: 17, fontWeight: fontWeight.bold as any }} numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="faint" numberOfLines={1}>{sub}</Text>
    </View>
  );
}

export function InvestorKpiStrip() {
  const { data: k } = useInvestorKpis();
  if (!k) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      <Tile icon="users" tone={palette.brand} label="Total clients" value={String(k.totalActive)} sub={`${k.totalAll} all-time`} />
      <Tile icon="dollar-sign" tone={palette.success} label="Total AUM" value={inr(k.totalAum)} sub="active clients" />
      <Tile icon="trending-up" tone={palette.success} label="Monthly SIP" value={inr(k.sipBook)} sub="active SIPs" />
      <Tile icon="award" tone={palette.violet} label="A-tier clients" value={String(k.tierA)} sub={`${k.tierAPct}% of book`} />
      <Tile icon="calendar" tone={palette.warning} label="Reviews due" value={String(k.reviewsDue)} sub="schedule meetings" />
      <Tile icon="shield" tone={palette.danger} label="KYC expiring 30d" value={String(k.kycExpiring)} sub="renew or refresh" />
      <Tile icon="user-x" tone={palette.warning} label="Nominee missing" value={String(k.nomineeMissing)} sub="transmission risk" />
      <Tile icon="moon" tone={palette.muted} label="Dormant" value={String(k.dormant)} sub="no tx in 180d" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.sm },
  tile: { width: 128, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
});
