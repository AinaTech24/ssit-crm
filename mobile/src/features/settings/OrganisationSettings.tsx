/**
 * Organisation profile — parity with web /dashboard/settings/organisation.
 * Owner-editable identity/contact/address/business-profile (PATCH /api/tenant);
 * ARN/EUIN/GSTIN/owner/license read-only (SSIT-managed). Colours live in the
 * Appearance page. Logo upload is web-only for now.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { titleCase } from "../../lib/format";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useTenant, useSaveOrg } from "./api";

const EDITABLE = ["displayName", "legalName", "email", "phone", "website", "addressLine1", "city", "state", "pincode", "aumRange", "sipBookRange", "teamSize", "currentSoftwareUsed"] as const;

export function OrganisationSettings() {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data, isLoading, isError, refetch } = useTenant();
  const save = useSaveOrg();
  const t = data?.tenant ?? data ?? {};
  const license = data?.license ?? {};

  const initial = useMemo(
    () => ({
      displayName: t.displayName ?? "",
      legalName: t.legalName ?? "",
      email: t.email ?? "",
      phone: t.phone ?? "",
      website: t.website ?? "",
      addressLine1: t.address?.line1 ?? "",
      city: t.address?.city ?? "",
      state: t.address?.state ?? "",
      pincode: t.address?.pincode ?? "",
      aumRange: t.aumRange ?? "",
      sipBookRange: t.sipBookRange ?? "",
      teamSize: t.teamSize ?? "",
      currentSoftwareUsed: t.currentSoftwareUsed ?? "",
    }),
    [t]
  );
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const state = form ?? initial;
  const set = (k: string, v: string) => setForm({ ...state, [k]: v });
  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Organisation profile" /><LoadingState /></View>;
  if (isError) return <View style={styles.screen}><ScreenHeader title="Organisation profile" /><ErrorState onRetry={refetch} /></View>;

  const dirty = EDITABLE.some((k) => (state as any)[k] !== (initial as any)[k]);

  const onSave = () => {
    setMsg(null);
    save.mutate(
      {
        displayName: state.displayName, legalName: state.legalName, email: state.email, phone: state.phone, website: state.website,
        aumRange: state.aumRange, sipBookRange: state.sipBookRange, teamSize: state.teamSize, currentSoftwareUsed: state.currentSoftwareUsed,
        address: { line1: state.addressLine1, city: state.city, state: state.state, pincode: state.pincode, country: "India" },
      },
      { onSuccess: () => { setForm(null); setMsg("Saved."); }, onError: (e: any) => setMsg(e?.message ?? "Could not save.") }
    );
  };

  const editable = (label: string, key: keyof typeof initial, kb?: any) => (
    <TextField label={label} value={(state as any)[key]} onChangeText={canEdit ? (v) => set(key, v) : () => {}} keyboardType={kb} autoCapitalize={key === "email" || key === "website" ? "none" : "sentences"} />
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Organisation profile" subtitle="Identity, contact & branding" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!canEdit ? (
          <Card flat style={{ marginBottom: spacing.lg }}>
            <Text variant="caption" tone="muted">Only the firm owner can edit these. Shown read-only.</Text>
          </Card>
        ) : null}

        <Text style={styles.section}>IDENTITY</Text>
        <Card>
          {editable("Organisation name (display)", "displayName")}
          {editable("Legal name", "legalName")}
          <RO label="Owner" value={me?.user.name ?? "—"} note={me?.user.email} />
          <RO label="ARN" value={t.arn ?? "—"} note="Managed by SSIT" />
          <RO label="Principal EUIN" value={t.principalEuin ?? "—"} note="Managed by SSIT" />
          <RO label="GSTIN" value={t.gstNumber ?? "—"} last />
        </Card>

        <Text style={styles.section}>CONTACT</Text>
        <Card>
          {editable("Email", "email", "email-address")}
          {editable("Mobile / phone", "phone", "phone-pad")}
          {editable("Website", "website")}
        </Card>

        <Text style={styles.section}>ADDRESS</Text>
        <Card>
          {editable("Address line", "addressLine1")}
          {editable("City", "city")}
          {editable("State", "state")}
          {editable("Pincode", "pincode", "number-pad")}
        </Card>

        <Text style={styles.section}>BUSINESS PROFILE</Text>
        <Card>
          {editable("Approx AUM range", "aumRange")}
          {editable("SIP book range", "sipBookRange")}
          {editable("Team size", "teamSize")}
          {editable("Current software", "currentSoftwareUsed")}
        </Card>

        <Text style={styles.section}>LICENSE & PACKAGE</Text>
        <Card flat style={{ padding: 0 }}>
          <View style={styles.roRow}>
            <Text variant="label" tone="muted">License status</Text>
            <StatusPill label={titleCase(license.status) || "—"} tone={license.isRestricted ? "danger" : "success"} dot={false} />
          </View>
          <RO label="Package" value={license.packageKey ? titleCase(license.packageKey) : "—"} note="Contact SSIT to change" last />
        </Card>

        {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginTop: spacing.md }}>{msg}</Text> : null}

        {canEdit ? (
          <Button label="Save changes" style={{ marginTop: spacing.lg }} full disabled={!dirty} loading={save.isPending} onPress={onSave} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function RO({ label, value, note, last }: { label: string; value: string; note?: string; last?: boolean }) {
  return (
    <View style={[styles.roRow, !last && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text variant="label" tone="muted">{label}</Text>
        {note ? <Text variant="caption" tone="faint">{note}</Text> : null}
      </View>
      <Text variant="body" style={{ color: palette.ink, maxWidth: "55%", textAlign: "right" }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  roRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
