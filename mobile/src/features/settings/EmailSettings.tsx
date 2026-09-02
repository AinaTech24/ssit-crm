/**
 * Email setup — parity with web /dashboard/settings/email (sender config). Set
 * the from-name, optional from-email and reply-to used on every outbound email.
 * GET/POST /api/settings/email-sender.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { LoadingState, ErrorState } from "../../components/states";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useEmailSender, useSaveEmailSender } from "./api";

export function EmailSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEmailSender();
  const save = useSaveEmailSender();

  const initial = useMemo(() => ({ fromName: data?.fromName ?? "", fromEmail: data?.fromEmail ?? "", replyTo: data?.replyTo ?? "" }), [data]);
  const [form, setForm] = useState<typeof initial | null>(null);
  const state = form ?? initial;
  const set = (k: keyof typeof initial, v: string) => setForm({ ...state, [k]: v });
  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Email setup" /><LoadingState /></View>;
  if (isError) return <View style={styles.screen}><ScreenHeader title="Email setup" /><ErrorState onRetry={refetch} /></View>;

  const dirty = state.fromName !== initial.fromName || state.fromEmail !== initial.fromEmail || state.replyTo !== initial.replyTo;

  const onSave = () => {
    setMsg(null);
    if (!state.fromName.trim()) return setMsg("Sender name is required.");
    save.mutate(
      { fromName: state.fromName.trim(), fromEmail: state.fromEmail.trim() || undefined, replyTo: state.replyTo.trim() || undefined },
      { onSuccess: () => { setForm(null); setMsg("Saved."); }, onError: (e: any) => setMsg(e?.message ?? "Could not save.") }
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Email setup" subtitle="Outbound sender" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card flat style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="info" size={15} color={palette.muted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            A custom from-email needs domain verification (DKIM/SPF) — do that on the web CRM. Name & reply-to work immediately.
          </Text>
        </Card>

        <Text style={styles.section}>SENDER</Text>
        <Card>
          <TextField label="From name" value={state.fromName} onChangeText={(v) => set("fromName", v)} placeholder="e.g. Rajesh from Demo Wealth" />
          <TextField label="From email (optional)" value={state.fromEmail} onChangeText={(v) => set("fromEmail", v)} placeholder="advisor@yourfirm.com" keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Reply-to (optional)" value={state.replyTo} onChangeText={(v) => set("replyTo", v)} placeholder="you@yourfirm.com" keyboardType="email-address" autoCapitalize="none" />
          {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginBottom: spacing.sm }}>{msg}</Text> : null}
          <Button label="Save" full disabled={!dirty} loading={save.isPending} onPress={onSave} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginBottom: spacing.sm },
});
