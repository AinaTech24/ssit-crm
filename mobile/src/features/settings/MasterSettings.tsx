/**
 * Master settings — parity with web /dashboard/settings/masters + masters/[type].
 * MastersHub lists the 15 look-up tables; MasterTypeScreen is the per-type CRUD
 * (add custom values, delete/deactivate). GET/POST/DELETE /api/masters/<type>.
 */

import React, { useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState, EmptyState } from "../../components/states";
import { confirmDelete } from "../../lib/confirm";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { MASTER_TYPES, masterLabel, useMasterValues, useAddMasterValue, useDeleteMasterValue } from "./api";

export function MastersHub() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Master settings" subtitle="Look-up tables" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Card flat style={{ padding: 0 }}>
          {MASTER_TYPES.map((m, i) => (
            <Pressable key={m.type} style={[styles.row, i < MASTER_TYPES.length - 1 && styles.divider]} onPress={() => router.push(`/m/masters-${m.type}` as any)}>
              <View style={styles.iconWrap}><Feather name="database" size={16} color={palette.brandDark} /></View>
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ color: palette.ink }}>{m.label}</Text>
                <Text variant="caption" tone="muted" numberOfLines={2}>{m.desc}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={palette.faint} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

export function MasterTypeScreen({ type }: { type: string }) {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useMasterValues(type);
  const add = useAddMasterValue(type);
  const del = useDeleteMasterValue(type);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    if (label.trim().length < 1) return setErr("Enter a value.");
    add.mutate(label.trim(), { onSuccess: () => setLabel(""), onError: (e: any) => setErr(e?.message ?? "Could not add.") });
  };

  const values = (data?.values ?? []).filter((v) => v.isActive);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={masterLabel(type)} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <TextField label="Add a value" value={label} onChangeText={setLabel} placeholder="New entry label" />
          {err ? <Text variant="caption" style={{ color: palette.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
          <Button label="Add" full loading={add.isPending} onPress={submit} icon={<Feather name="plus" size={16} color={palette.white} />} />
        </Card>

        <Text style={styles.section}>VALUES</Text>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : values.length === 0 ? (
          <EmptyState icon="database" title="No values" message="Add one above." />
        ) : (
          <Card flat style={{ padding: 0 }}>
            {values.map((v, i) => (
              <View key={v.id} style={[styles.row, i < values.length - 1 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{v.label}</Text>
                  {v.description ? <Text variant="caption" tone="muted">{v.description}</Text> : null}
                </View>
                {v.isSystemDefault ? <StatusPill label="Default" tone="neutral" dot={false} size="sm" /> : null}
                <Pressable
                  onPress={() => confirmDelete({ title: v.isSystemDefault ? "Disable value?" : "Delete value?", message: `"${v.label}"` }, () => del.mutate(v.key))}
                  hitSlop={8}
                  style={styles.delBtn}
                >
                  <Feather name="trash-2" size={16} color={palette.danger} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  delBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
