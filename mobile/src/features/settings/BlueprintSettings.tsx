/**
 * Blueprint editor — parity with web /dashboard/settings/blueprints. Hub lists
 * the 5 workflow blueprints; the editor lets an owner rename stages, set each
 * stage's SLA (days) and description. GET /api/blueprints, PUT /api/blueprints/[id]/stages.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { titleCase } from "../../lib/format";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useBlueprints, useSaveBlueprintStages, type BlueprintStage } from "./api";

export function BlueprintsHub() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useBlueprints();
  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Blueprint editor" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Blueprint editor" /><ErrorState onRetry={refetch} /></View>;
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Blueprint editor" subtitle="Stages & SLAs" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Card flat style={{ padding: 0 }}>
          {data.blueprints.map((b, i) => (
            <Pressable key={b.id} style={[styles.row, i < data.blueprints.length - 1 && styles.divider]} onPress={() => router.push(`/m/blueprint-${b.id}` as any)}>
              <View style={styles.iconWrap}><Feather name="git-branch" size={16} color={palette.brandDark} /></View>
              <View style={{ flex: 1 }}>
                <Text variant="body">{b.blueprintName || titleCase(b.moduleName)}</Text>
                <Text variant="caption" tone="muted">{titleCase(b.moduleName)} · {b.stages.length} stage{b.stages.length === 1 ? "" : "s"}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={palette.faint} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

export function BlueprintEditor({ id }: { id: string }) {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data, isLoading, isError, refetch } = useBlueprints();
  const save = useSaveBlueprintStages(id);

  const bp = useMemo(() => data?.blueprints.find((b) => b.id === id), [data, id]);
  const [stages, setStages] = useState<BlueprintStage[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (bp && !stages) setStages(bp.stages.map((s) => ({ ...s }))); }, [bp, stages]);

  if (isLoading || !stages) return <View style={styles.screen}><ScreenHeader title="Blueprint" />{isError ? <ErrorState onRetry={refetch} /> : <LoadingState />}</View>;
  if (!bp) return <View style={styles.screen}><ScreenHeader title="Blueprint" /><ErrorState message="Blueprint not found" onRetry={refetch} /></View>;

  const setStage = (i: number, patch: Partial<BlueprintStage>) => setStages((s) => (s ? s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)) : s));

  const onSave = () => {
    setMsg(null);
    save.mutate(
      stages.map((s) => ({ id: s.id, stageName: s.stageName, description: s.description ?? null, slaDays: s.slaDays })),
      { onSuccess: () => setMsg("Saved."), onError: (e: any) => setMsg(e?.message ?? "Could not save.") }
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={bp.blueprintName || titleCase(bp.moduleName)} subtitle={`${stages.length} stages`} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!canEdit ? <Card flat style={{ marginBottom: spacing.md }}><Text variant="caption" tone="muted">Only the firm owner can edit stages. Shown read-only.</Text></Card> : null}
        {stages.map((s, i) => (
          <Card key={s.id} style={{ marginBottom: spacing.md }}>
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>Stage {i + 1}{s.stageKey ? ` · ${s.stageKey}` : ""}</Text>
            <TextField label="Stage name" value={s.stageName} onChangeText={canEdit ? (v) => setStage(i, { stageName: v }) : () => {}} />
            <TextField label="SLA (days)" value={s.slaDays == null ? "" : String(s.slaDays)} onChangeText={canEdit ? (v) => setStage(i, { slaDays: v.trim() === "" ? null : Number(v.replace(/\D/g, "")) }) : () => {}} keyboardType="number-pad" placeholder="none" />
            <TextField label="Description (optional)" value={s.description ?? ""} onChangeText={canEdit ? (v) => setStage(i, { description: v }) : () => {}} multiline />
          </Card>
        ))}
        {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginTop: spacing.md }}>{msg}</Text> : null}
        {canEdit ? <Button label="Save stages" full style={{ marginTop: spacing.md }} loading={save.isPending} onPress={onSave} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
