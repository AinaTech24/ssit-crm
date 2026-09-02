/**
 * Two-factor authentication — parity with web /dashboard/settings/security.
 * TOTP enroll (setup → QR + secret → verify code → backup codes) and disable
 * (confirm password). Self-service for every role.
 */

import React, { useState } from "react";
import { View, ScrollView, Image, TextInput, StyleSheet, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useProfile, useTwoFaSetup, useTwoFaEnable, useTwoFaDisable } from "./api";

type Phase = "idle" | "enrolling" | "showBackup";

export function SecuritySettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useProfile();
  const setup = useTwoFaSetup();
  const enable = useTwoFaEnable();
  const disable = useTwoFaDisable();

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Two-factor authentication" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Two-factor authentication" /><ErrorState onRetry={refetch} /></View>;

  const enabled = data.twoFaEnabled;

  const startSetup = () => {
    setErr(null);
    setup.mutate(undefined, {
      onSuccess: (r) => { setEnrollment(r); setPhase("enrolling"); },
      onError: (e: any) => setErr(e?.message ?? "Could not start setup."),
    });
  };
  const verify = () => {
    setErr(null);
    enable.mutate(code.trim(), {
      onSuccess: (r) => { setBackup(r.backupCodes ?? []); setPhase("showBackup"); setCode(""); },
      onError: (e: any) => setErr(e?.message ?? "Invalid code."),
    });
  };
  const doDisable = () => {
    setErr(null);
    disable.mutate(password, {
      onSuccess: () => { setPassword(""); setPhase("idle"); },
      onError: (e: any) => setErr(e?.message ?? "Invalid password."),
    });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Two-factor authentication" subtitle={data.user.email} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Feather name="shield" size={22} color={enabled ? palette.success : palette.warning} />
          <Text variant="body" style={{ flex: 1, color: palette.ink }}>Two-factor authentication</Text>
          <StatusPill label={enabled ? "Enabled" : "Not enabled"} tone={enabled ? "success" : "warning"} />
        </Card>

        <Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
          Add a one-time code from an authenticator app (Google Authenticator, Authy, 1Password) on top of your password. Strongly recommended for an account with access to client PII.
        </Text>

        {err ? <Text variant="caption" style={{ color: palette.danger, marginTop: spacing.md }}>{err}</Text> : null}

        {/* ENABLE — idle */}
        {!enabled && phase === "idle" ? (
          <Button label="Set up 2FA" style={{ marginTop: spacing.lg }} loading={setup.isPending} onPress={startSetup} full />
        ) : null}

        {/* ENABLE — enrolling */}
        {phase === "enrolling" && enrollment ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="body" style={{ marginBottom: spacing.md }}>Scan this QR in your authenticator app:</Text>
            <Image source={{ uri: enrollment.qrDataUrl }} style={styles.qr} resizeMode="contain" />
            <Button label="Open in authenticator app" variant="ghost" onPress={() => Linking.openURL(enrollment.otpauthUri).catch(() => {})} />
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Or enter this key manually (long-press to copy):</Text>
            <Text selectable style={styles.secret}>{enrollment.secret}</Text>
            <TextField label="Enter the 6-digit code to confirm" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" full onPress={() => { setPhase("idle"); setEnrollment(null); setCode(""); }} /></View>
              <View style={{ flex: 2 }}><Button label="Verify & enable" full disabled={code.length !== 6} loading={enable.isPending} onPress={verify} /></View>
            </View>
          </Card>
        ) : null}

        {/* ENABLE — backup codes */}
        {phase === "showBackup" ? (
          <Card style={{ marginTop: spacing.lg, borderColor: palette.success }}>
            <Text variant="body" style={{ color: palette.success, marginBottom: spacing.sm }}>
              2FA is on. Save these backup codes somewhere safe — each works once if you lose your authenticator. They won't be shown again.
            </Text>
            <View style={styles.codesGrid}>
              {backup.map((c) => <Text key={c} selectable style={styles.code}>{c}</Text>)}
            </View>
            <Button label="Done" style={{ marginTop: spacing.md }} full onPress={() => setPhase("idle")} />
          </Card>
        ) : null}

        {/* DISABLE — idle & enabled */}
        {enabled && phase === "idle" ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="body" style={{ marginBottom: spacing.md }}>To turn off 2FA, confirm your password.</Text>
            <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
            <Button label="Disable 2FA" variant="danger" full disabled={!password} loading={disable.isPending} onPress={doDisable} />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  qr: { width: 200, height: 200, alignSelf: "center", backgroundColor: palette.white, borderRadius: radius.md },
  secret: { fontFamily: "monospace", fontSize: fontSize.md, color: palette.ink, backgroundColor: palette.surfaceSunken, padding: spacing.md, borderRadius: radius.sm, marginTop: 4, marginBottom: spacing.md, letterSpacing: 1 },
  codesGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  code: { width: "47%", fontFamily: "monospace", fontSize: fontSize.md, color: palette.ink, backgroundColor: palette.surfaceSunken, paddingVertical: spacing.sm, textAlign: "center", borderRadius: radius.sm },
});
