/**
 * Notification templates — parity with web /dashboard/settings/notification-
 * templates. The lead-to-client journey templates each need an Email + WhatsApp
 * variant (built & Meta-approved in the Templates module). This screen lists the
 * journey templates by stage; tap "Open templates" to create/edit them.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { palette, radius, spacing } from "../../theme/tokens";

const SPEC = [
  { label: "Lead welcome", channels: ["email", "whatsapp"], stage: "Stage 1" },
  { label: "Referrer thank-you", channels: ["email", "whatsapp"], stage: "Stage 1" },
  { label: "Meeting confirmation", channels: ["email", "whatsapp"], stage: "Stage 2" },
  { label: "Meeting reminder (24h before)", channels: ["email", "whatsapp"], stage: "Stage 3" },
  { label: "Risk profile questionnaire request", channels: ["email", "whatsapp"], stage: "Stage 5" },
  { label: "Risk profile completion confirmation", channels: ["email", "whatsapp"], stage: "Stage 5" },
  { label: "Proposal sent", channels: ["email", "whatsapp"], stage: "Stage 7" },
  { label: "Proposal reminder (no response)", channels: ["email", "whatsapp"], stage: "Stage 7" },
  { label: "Proposal approved confirmation", channels: ["email", "whatsapp"], stage: "Stage 8" },
  { label: "Document checklist request", channels: ["email", "whatsapp"], stage: "Stage 9" },
  { label: "Missing document reminder", channels: ["email", "whatsapp"], stage: "Stage 10" },
  { label: "Operations onboarding update", channels: ["email"], stage: "Stage 13" },
  { label: "Client welcome + portal login", channels: ["email", "whatsapp"], stage: "Stage 14" },
  { label: "Review cycle scheduled message", channels: ["email", "whatsapp"], stage: "Stage 15" },
];

export function NotificationTemplatesSettings() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Notification templates" subtitle="Lead-to-client journey" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Card flat style={{ marginBottom: spacing.lg }}>
          <Text variant="caption" tone="muted">
            The {SPEC.length} templates that drive every automated message in the lead-to-client journey. Each needs a branded email + a Meta-approved WhatsApp variant — build & edit them on the web CRM.
          </Text>
        </Card>

        {SPEC.map((t) => (
          <Card key={t.label} style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={styles.iconWrap}><Feather name="bell" size={15} color={palette.brandDark} /></View>
            <View style={{ flex: 1 }}>
              <Text variant="body">{t.label}</Text>
              <Text variant="caption" tone="muted">{t.stage} · {t.channels.map((c) => (c === "email" ? "Email" : "WhatsApp")).join(" + ")}</Text>
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
