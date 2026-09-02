/**
 * Auto-assignment rules — parity with web /dashboard/settings/assignment-rules.
 * Route new leads/clients to a pool of team members (round-robin / load-balanced
 * / specific). List, add, toggle-active, delete. GET/POST /api/assignment-rules,
 * PATCH/DELETE /api/assignment-rules/[id].
 */

import React, { useState } from "react";
import { View, ScrollView, Pressable, Switch, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Chip } from "../../components/ui/Chip";
import { LoadingState, ErrorState, EmptyState } from "../../components/states";
import { confirmDelete } from "../../lib/confirm";
import { titleCase } from "../../lib/format";
import { palette, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useAssignmentRules, useCreateAssignmentRule, useDeleteAssignmentRule, useToggleAssignmentRule, useEmployeesLite } from "./api";

const SUBJECTS = [{ value: "lead", label: "Leads" }, { value: "investor", label: "Clients" }];
const STRATEGIES = [
  { value: "round_robin", label: "Round-robin" },
  { value: "load_balanced", label: "Load-balanced" },
  { value: "specific", label: "Specific person" },
];

export function AssignmentRulesSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useAssignmentRules();
  const emps = useEmployeesLite();
  const create = useCreateAssignmentRule();
  const del = useDeleteAssignmentRule();
  const toggle = useToggleAssignmentRule();

  const [name, setName] = useState("");
  const [subjectType, setSubjectType] = useState("lead");
  const [strategy, setStrategy] = useState("round_robin");
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const members = emps.data?.rows ?? [];
  const rules = data?.rules ?? [];
  const subjOf = (r: any) => r.subjectType ?? r.subject_type;
  const activeOf = (r: any) => r.isActive ?? r.is_active;
  const targetsOf = (r: any) => r.targetUserIds ?? r.target_user_ids ?? [];

  const submit = () => {
    setErr(null);
    if (name.trim().length < 2) return setErr("Enter a rule name (min 2 chars).");
    if (picked.length === 0) return setErr("Pick at least one team member to route to.");
    create.mutate(
      { name: name.trim(), subjectType, strategy, targetUserIds: picked, priority: 100 },
      { onSuccess: () => { setName(""); setPicked([]); }, onError: (e: any) => setErr(e?.message ?? "Could not create rule.") }
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Auto-assignment rules" subtitle="Route new leads & clients" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.section}>ADD A RULE</Text>
        <Card>
          <TextField label="Rule name" value={name} onChangeText={setName} placeholder="e.g. New website leads → sales pod" />
          <SelectField label="Applies to" value={subjectType} options={SUBJECTS} onChange={setSubjectType} />
          <SelectField label="Strategy" value={strategy} options={STRATEGIES} onChange={setStrategy} />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Route to</Text>
          {emps.isLoading ? (
            <Text tone="muted" variant="caption">Loading team…</Text>
          ) : (
            <View style={styles.chips}>
              {members.map((m) => (
                <Chip key={m.id} label={m.name} selected={picked.includes(m.id)} onPress={() => setPicked((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} />
              ))}
            </View>
          )}
          {err ? <Text variant="caption" style={{ color: palette.danger, marginTop: spacing.sm }}>{err}</Text> : null}
          <Button label="Create rule" full style={{ marginTop: spacing.md }} loading={create.isPending} onPress={submit} icon={<Feather name="plus" size={16} color={palette.white} />} />
        </Card>

        <Text style={styles.section}>RULES</Text>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : rules.length === 0 ? (
          <EmptyState icon="git-branch" title="No rules yet" message="Add one above to auto-route new leads & clients." />
        ) : (
          <Card flat style={{ padding: 0 }}>
            {rules.map((r, i) => (
              <View key={r.id} style={[styles.row, i < rules.length - 1 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{r.name}</Text>
                  <Text variant="caption" tone="muted">
                    {titleCase(subjOf(r))} · {titleCase(r.strategy)} · {targetsOf(r).length} member{targetsOf(r).length === 1 ? "" : "s"}
                  </Text>
                </View>
                <Switch
                  value={!!activeOf(r)}
                  onValueChange={(v) => toggle.mutate({ id: r.id, isActive: v })}
                  trackColor={{ true: palette.brand, false: palette.line }}
                  thumbColor={palette.white}
                />
                <Pressable onPress={() => confirmDelete({ title: "Delete rule?", message: `"${r.name}"` }, () => del.mutate(r.id))} hitSlop={8} style={styles.delBtn}>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  delBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
