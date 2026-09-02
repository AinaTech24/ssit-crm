/**
 * Firm profile — a read-only snapshot of the firm: identity, regulatory IDs
 * (ARN / EUIN / GSTIN), contact, address, business profile and license. Backed
 * by GET /api/tenant (+ /api/me for the owner). Editing lives in Settings →
 * Organisation profile (owner-only). Reached from the header profile menu.
 */

import React from "react";
import { View, Image, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { absUrl } from "../../api/client";
import { useTenant } from "../settings/api";
import { useBrand } from "../../theme/brand";
import { titleCase, initials } from "../../lib/format";
import { palette, spacing, radius, fontSize, fontWeight } from "../../theme/tokens";

export function FirmProfile() {
  const router = useRouter();
  const { brand } = useBrand();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data, isLoading, isError, refetch } = useTenant();

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Firm profile" onBack={() => router.back()} /><LoadingState /></View>;
  if (isError) return <View style={styles.screen}><ScreenHeader title="Firm profile" onBack={() => router.back()} /><ErrorState onRetry={refetch} /></View>;

  const t: any = data?.tenant ?? data ?? {};
  const license: any = data?.license ?? {};
  const name = t.displayName || t.legalName || "Your firm";
  const addr = [t.address?.line1, t.address?.city, t.address?.state, t.address?.pincode].filter(Boolean).join(", ");

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Firm profile" subtitle={t.legalName ?? undefined} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            {absUrl(t.logoUrl) ? (
              <Image source={{ uri: absUrl(t.logoUrl)! }} style={styles.logo} resizeMode="cover" />
            ) : (
              <View style={[styles.logo, { backgroundColor: brand }]}>
                <Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 20 }}>{initials(name) || "F"}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text variant="title" numberOfLines={2}>{name}</Text>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4, flexWrap: "wrap" }}>
                <StatusPill label={titleCase(license.status) || "Active"} tone={license.isRestricted ? "danger" : "success"} size="sm" dot={false} />
                {license.packageKey ? <StatusPill label={titleCase(license.packageKey)} tone="neutral" size="sm" dot={false} /> : null}
              </View>
            </View>
          </View>
        </Card>

        <Section title="Regulatory" />
        <Card flat style={{ padding: 0 }}>
          <Row label="ARN" value={t.arn} note="Managed by SSIT" />
          <Row label="Principal EUIN" value={t.principalEuin} note="Managed by SSIT" />
          <Row label="GSTIN" value={t.gstNumber} />
          <Row label="Owner" value={me?.user.name} note={me?.user.email} last />
        </Card>

        <Section title="Contact" />
        <Card flat style={{ padding: 0 }}>
          <Row label="Email" value={t.email} />
          <Row label="Phone" value={t.phone} />
          <Row label="Website" value={t.website} />
          <Row label="Address" value={addr || undefined} last />
        </Card>

        <Section title="Business profile" />
        <Card flat style={{ padding: 0 }}>
          <Row label="Approx AUM" value={t.aumRange} />
          <Row label="SIP book" value={t.sipBookRange} />
          <Row label="Team size" value={t.teamSize != null ? String(t.teamSize) : undefined} last />
        </Card>

        {canEdit ? (
          <Button
            label="Edit organisation profile"
            variant="secondary"
            icon={<Feather name="edit-2" size={15} color={palette.ink} />}
            onPress={() => router.push("/m/settings-organisation" as any)}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title.toUpperCase()}</Text>;
}

function Row({ label, value, note, last }: { label: string; value?: string | null; note?: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text variant="label" tone="muted">{label}</Text>
        {note ? <Text variant="caption" tone="faint">{note}</Text> : null}
      </View>
      <Text variant="body" style={{ color: palette.ink, maxWidth: "55%", textAlign: "right" }} numberOfLines={1}>{value || "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  logo: { width: 56, height: 56, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
