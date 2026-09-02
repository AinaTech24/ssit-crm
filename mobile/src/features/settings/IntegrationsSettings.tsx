/**
 * Integrations — parity with web /dashboard/settings/integrations. Informational
 * list of the platform integrations; connection/credentials are configured
 * server-side (by SSIT / on web), so this is a read-only overview on mobile.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";

const INTEGRATIONS = [
  { name: "BSE Star MF", desc: "Place SIPs, lumpsum, redemption orders. Requires your BSE member code + user id." },
  { name: "NSE NMF II", desc: "Alternative to BSE for transaction execution." },
  { name: "CAMS / KFintech reverse feed", desc: "Daily transaction + folio reconciliation from the RTAs." },
  { name: "Razorpay", desc: "Recurring subscription auto-debit for your CRM billing." },
  { name: "KYC providers (Karza / Hyperverge / IDfy)", desc: "CKYC fetch, eKYC, video KYC, Aadhaar XML, DigiLocker, eSign." },
  { name: "Account Aggregator", desc: "Consent-based financial data pull for holistic advice." },
];

export function IntegrationsSettings() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Integrations" subtitle="Data feeds & execution" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Card flat style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="info" size={15} color={palette.muted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Connection & credentials are configured by SSIT or on the web CRM. This is a read-only overview.
          </Text>
        </Card>

        {INTEGRATIONS.map((it) => (
          <Card key={it.name} style={{ marginBottom: spacing.md, flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
            <View style={styles.iconWrap}><Feather name="link" size={16} color={palette.brandDark} /></View>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{it.name}</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{it.desc}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
