/**
 * My Profile — parity with web /dashboard/settings/profile. Identity, edit name,
 * email-verify, change password (with strength meter), sign-out-everywhere, 2FA
 * status, read-only targets + leave balances + recent activity.
 */

import React, { useState } from "react";
import { View, Image, Pressable, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { useSession } from "../../state/session";
import { api, absUrl } from "../../api/client";
import { toast } from "../../lib/toast";
import { confirmDelete } from "../../lib/confirm";
import { inr, timeAgo, titleCase } from "../../lib/format";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import {
  useProfile, useUpdateProfile, useChangePassword, useSignOutEverywhere, useSendVerifyEmail, pwStrength,
} from "./api";

export function ProfileSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useProfile();
  const signOutLocal = useSession((s) => s.signOut);
  const updateProfile = useUpdateProfile();
  const changePw = useChangePassword();
  const signOutAll = useSignOutEverywhere();
  const verifyEmail = useSendVerifyEmail();

  const [name, setName] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Pick from the photo library → vault upload (public "general" class, same as
  // the web avatar flow) → save the served asset path on the profile.
  const changePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error("Allow photo access to set a picture.");
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    const mime = a.mimeType ?? "image/jpeg";
    const ext = mime.split("/")[1] ?? "jpg";
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", { uri: a.uri, name: `avatar.${ext}`, type: mime } as any);
      form.append("kind", "general");
      form.append("docType", "avatar");
      const up = await api.upload<{ key: string }>("/api/compliance/upload", form);
      await updateProfile.mutateAsync({ avatarUrl: `/api/upload-local/${up.key}` });
      toast.success("Photo updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not upload the photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="My profile" /><LoadingState label="Loading profile…" /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="My profile" /><ErrorState onRetry={refetch} /></View>;

  const u = data.user;
  const nameVal = name ?? u.name;
  const nameDirty = nameVal.trim() !== u.name && nameVal.trim().length >= 2;
  const strength = pwStrength(newPw);

  const saveName = () => updateProfile.mutate({ name: nameVal.trim() }, { onSuccess: () => setName(null) });

  const submitPw = () => {
    setPwMsg(null);
    if (newPw.length < 8) return setPwMsg("New password must be at least 8 characters.");
    if (newPw === curPw) return setPwMsg("New password must be different.");
    if (newPw !== confirmPw) return setPwMsg("Passwords don't match.");
    changePw.mutate(
      { currentPassword: curPw, newPassword: newPw },
      {
        onSuccess: () => { setCurPw(""); setNewPw(""); setConfirmPw(""); setPwMsg("Password updated."); },
        onError: (e: any) => setPwMsg(e?.message ?? "Could not update password."),
      }
    );
  };

  const doSignOutEverywhere = () =>
    confirmDelete(
      { title: "Sign out of all devices?", message: "Including this one — you'll need to log in again.", confirmLabel: "Sign out all" },
      () => signOutAll.mutate(undefined, { onSuccess: () => signOutLocal() })
    );

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My profile" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity — tap the avatar to change the photo */}
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pressable onPress={changePhoto} disabled={uploadingPhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {absUrl(u.avatarUrl) ? (
              <Image source={{ uri: absUrl(u.avatarUrl)! }} style={styles.avatar} />
            ) : (
              <View style={styles.avatar}>
                <Text style={{ color: palette.white, fontWeight: fontWeight.bold as any, fontSize: 20 }}>{(u.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.camBadge}>
              <Feather name={uploadingPhoto ? "loader" : "camera"} size={11} color={palette.white} />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{u.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 }}>
              <Text variant="caption" tone="muted">{u.email}</Text>
              <StatusPill label={u.emailVerified ? "Verified" : "Not verified"} tone={u.emailVerified ? "success" : "warning"} dot={false} size="sm" />
            </View>
            <Text variant="caption" tone="brand" style={{ marginTop: 2 }}>{u.roleLabel}{u.department ? ` · ${titleCase(u.department)}` : ""}</Text>
          </View>
        </Card>

        {!u.emailVerified ? (
          <Button label="Send verification email" variant="secondary" style={{ marginTop: spacing.sm }} loading={verifyEmail.isPending}
            onPress={() => verifyEmail.mutate()} icon={<Feather name="mail" size={16} color={palette.ink} />} />
        ) : null}

        {/* 2FA nudge */}
        <Card flat style={{ marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Feather name="shield" size={20} color={data.twoFaEnabled ? palette.success : palette.warning} />
          <Text variant="body" style={{ flex: 1, color: palette.ink }}>
            {data.twoFaEnabled ? "2FA enabled — your account is protected." : "2FA not enabled. Turn it on for extra security."}
          </Text>
          <Button label={data.twoFaEnabled ? "Manage" : "Enable"} size="sm" variant="secondary" onPress={() => router.push("/m/settings/security" as any)} />
        </Card>

        {/* Your details */}
        <Text style={styles.section}>YOUR DETAILS</Text>
        <Card>
          <TextField label="Full name" value={nameVal} onChangeText={(v) => setName(v)} />
          <Button label="Save name" disabled={!nameDirty} loading={updateProfile.isPending} onPress={saveName} full />
        </Card>

        {/* Change password */}
        <Text style={styles.section}>CHANGE PASSWORD</Text>
        <Card>
          <TextField label="Current password" value={curPw} onChangeText={setCurPw} secureTextEntry autoCapitalize="none" />
          <TextField label="New password" value={newPw} onChangeText={setNewPw} secureTextEntry autoCapitalize="none" />
          {newPw ? (
            <View style={{ marginBottom: spacing.md, marginTop: -spacing.sm }}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength.score ? strength.color : palette.line }} />
                ))}
              </View>
              <Text variant="caption" style={{ color: strength.color, marginTop: 4 }}>{strength.label} · 8+ chars with mixed case, a number & a symbol is best.</Text>
            </View>
          ) : null}
          <TextField label="Confirm new password" value={confirmPw} onChangeText={setConfirmPw} secureTextEntry autoCapitalize="none" />
          {pwMsg ? <Text variant="caption" style={{ color: pwMsg === "Password updated." ? palette.success : palette.danger, marginBottom: spacing.sm }}>{pwMsg}</Text> : null}
          <Button label="Update password" disabled={!curPw || !newPw} loading={changePw.isPending} onPress={submitPw} full />
          <View style={{ height: spacing.md }} />
          <Button label="Sign out of all devices" variant="ghost" onPress={doSignOutEverywhere} icon={<Feather name="log-out" size={16} color={palette.danger} />} />
          <Text variant="caption" tone="muted">Revokes every active session, including this one.</Text>
        </Card>

        {/* Targets */}
        <Text style={styles.section}>MY TARGETS</Text>
        <Card flat style={{ padding: 0 }}>
          <Row label="Annual business target" value={data.targets.annual != null ? inr(data.targets.annual) : "—"} />
          <Row label="Monthly SIP target" value={data.targets.sipMonthly != null ? inr(data.targets.sipMonthly) : "—"} last />
        </Card>

        {/* Leave */}
        <Text style={styles.section}>MY LEAVE (THIS FY)</Text>
        <View style={styles.leaveGrid}>
          {data.leave.map((l) => (
            <View key={l.type} style={styles.leaveTile}>
              <Text variant="caption" tone="muted">{l.label}</Text>
              <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold as any, color: palette.ink, marginTop: 2 }}>
                {l.entitlement == null ? "Unpaid" : `${l.remaining}/${l.entitlement}`}
              </Text>
              {l.entitlement != null ? <Text variant="caption" tone="muted">{l.used} used</Text> : null}
            </View>
          ))}
        </View>

        {/* Activity */}
        <Text style={styles.section}>RECENT ACTIVITY</Text>
        <Card flat style={{ padding: 0 }}>
          {data.activity.length === 0 ? (
            <View style={{ padding: spacing.lg }}><Text variant="caption" tone="muted">No recent activity recorded.</Text></View>
          ) : (
            data.activity.map((a, i) => (
              <View key={i} style={[styles.actRow, i < data.activity.length - 1 && styles.divider]}>
                <Text variant="body" style={{ flex: 1, color: palette.ink }} numberOfLines={1}>
                  {titleCase(a.action.replace(/[._]/g, " "))}{a.entityType ? ` · ${a.entityType}` : ""}
                </Text>
                <Text variant="caption" tone="muted">{timeAgo(a.at)}</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text variant="label" tone="muted">{label}</Text>
      <Text variant="body" style={{ color: palette.ink }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  camBadge: { position: "absolute", right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.surface },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  actRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  leaveGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  leaveTile: { width: "48%", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md },
});
