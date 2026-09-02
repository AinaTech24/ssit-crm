/**
 * Onboarding form fields — parity with web /dashboard/settings/onboarding-fields.
 * Toggle each KYC/account-opening field mandatory vs optional; an unchanged field
 * keeps the catalog default. Saves the diff-only override map (PUT).
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, Switch, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useOnboardingFields, useSaveOnboardingFields, type OnboardingField } from "./api";

export function OnboardingFieldsSettings() {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data, isLoading, isError, refetch } = useOnboardingFields();
  const save = useSaveOnboardingFields();

  // local[key] = effective mandatory boolean (overrides the catalog default)
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map: Record<string, OnboardingField[]> = {};
    for (const f of data?.catalog ?? []) (map[f.section] ??= []).push(f);
    return Object.entries(map);
  }, [data]);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Onboarding form fields" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Onboarding form fields" /><ErrorState onRetry={refetch} /></View>;

  const effective = (f: OnboardingField) => local[f.key] ?? data.overrides[f.key] ?? f.required;
  const dirty = Object.keys(local).some((k) => {
    const f = data.catalog.find((x) => x.key === k);
    return f ? local[k] !== (data.overrides[k] ?? f.required) : false;
  });

  const onSave = () => {
    setMsg(null);
    // Diff-only: only include keys whose effective value differs from the catalog default.
    const overrides: Record<string, boolean> = {};
    for (const f of data.catalog) {
      const eff = effective(f);
      if (eff !== f.required) overrides[f.key] = eff;
    }
    save.mutate(overrides, { onSuccess: () => { setLocal({}); setMsg("Saved."); }, onError: (e: any) => setMsg(e?.message ?? "Could not save.") });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Onboarding form fields" subtitle="Make fields mandatory or optional" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {!canEdit ? (
          <Card flat style={{ marginBottom: spacing.md }}><Text variant="caption" tone="muted">Only the firm owner can change these. Shown read-only.</Text></Card>
        ) : null}

        {grouped.map(([section, fields]) => (
          <View key={section} style={{ marginBottom: spacing.lg }}>
            <Text style={styles.section}>{section.toUpperCase()}</Text>
            <Card flat style={{ padding: 0 }}>
              {fields.map((f, i) => (
                <View key={f.key} style={[styles.row, i < fields.length - 1 && styles.divider]}>
                  <Text variant="body" style={{ flex: 1, color: palette.ink }}>{f.label}</Text>
                  <Text variant="caption" tone={effective(f) ? "danger" : "muted"} style={{ marginRight: spacing.sm }}>
                    {effective(f) ? "Mandatory" : "Optional"}
                  </Text>
                  <Switch
                    value={effective(f)}
                    disabled={!canEdit}
                    onValueChange={(v) => setLocal((s) => ({ ...s, [f.key]: v }))}
                    trackColor={{ true: palette.brand, false: palette.line }}
                    thumbColor={palette.white}
                  />
                </View>
              ))}
            </Card>
          </View>
        ))}

        {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginBottom: spacing.md }}>{msg}</Text> : null}
        {canEdit ? <Button label="Save changes" full disabled={!dirty} loading={save.isPending} onPress={onSave} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
