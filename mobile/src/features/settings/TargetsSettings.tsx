/**
 * Targets & quota — parity with web /dashboard/settings/targets. Owner picks a
 * team member and sets their annual target per KRA metric (₹ for business,
 * counts for the rest) for the current fiscal year. GET/POST /api/team/targets.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { LoadingState, ErrorState } from "../../components/states";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useTargets, useSaveTarget } from "./api";

export function TargetsSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useTargets();
  const save = useSaveTarget();

  const [userId, setUserId] = useState<string>("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = userId || data?.members?.[0]?.id || "";
  const saved = useMemo(() => (data && selected ? data.targets[selected] ?? {} : {}), [data, selected]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Targets & quota" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Targets & quota" /><ErrorState onRetry={refetch} /></View>;

  const valOf = (mk: string) => edits[mk] ?? (saved[mk] != null ? String(saved[mk]) : "");
  const dirtyKeys = data.metrics
    .map((m) => m.key)
    .filter((mk) => edits[mk] !== undefined && Number(edits[mk] || 0) !== Number(saved[mk] ?? 0));

  const onSave = async () => {
    setMsg(null);
    setBusy(true);
    try {
      for (const mk of dirtyKeys) {
        await save.mutateAsync({ userId: selected, metricKey: mk, annualTarget: Number(edits[mk] || 0), fiscalYear: data.fiscalYear });
      }
      setEdits({});
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Targets & quota" subtitle={`FY ${data.fiscalYear}`} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SelectField
          label="Team member"
          value={selected}
          options={data.members.map((m) => ({ value: m.id, label: m.name }))}
          onChange={(v) => { setUserId(v); setEdits({}); }}
        />

        <Text style={styles.section}>ANNUAL TARGETS</Text>
        <Card>
          {data.metrics.map((m) => (
            <TextField
              key={m.key}
              label={`${m.label}${m.unit === "inr" ? " (₹)" : " (count)"}`}
              value={valOf(m.key)}
              onChangeText={(v) => setEdits((s) => ({ ...s, [m.key]: v.replace(/[^0-9.]/g, "") }))}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          ))}
          {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginBottom: spacing.sm }}>{msg}</Text> : null}
          <Button label={dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}` : "Save"} full disabled={dirtyKeys.length === 0} loading={busy} onPress={onSave} />
        </Card>

        <Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
          Business targets are in rupees; the rest are counts. Achievement is tracked on the team scorecard.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
});
