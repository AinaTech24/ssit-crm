/**
 * Custom fields — parity with web /dashboard/settings/custom-fields. Per-entity
 * (Clients / Leads) list of custom field defs with add (label + type + options
 * for dropdowns) and delete. GET/POST/DELETE /api/settings/custom-fields.
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
import { SelectField } from "../../components/ui/SelectField";
import { Segmented } from "../../components/ui/Segmented";
import { LoadingState, ErrorState, EmptyState } from "../../components/states";
import { confirmDelete } from "../../lib/confirm";
import { titleCase } from "../../lib/format";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useCustomFields, useAddCustomField, useDeleteCustomField, CUSTOM_FIELD_TYPES } from "./api";

export function CustomFieldsSettings() {
  const router = useRouter();
  const [entity, setEntity] = useState<"investor" | "lead">("investor");
  const { data, isLoading, isError, refetch, isRefetching } = useCustomFields(entity);
  const add = useAddCustomField();
  const del = useDeleteCustomField(entity);

  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [optionsCsv, setOptionsCsv] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    if (label.trim().length < 1) return setErr("Enter a field label.");
    const options = type === "select" ? optionsCsv.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    if (type === "select" && (!options || options.length === 0)) return setErr("Dropdown fields need at least one option.");
    add.mutate(
      { entity, label: label.trim(), type, options },
      { onSuccess: () => { setLabel(""); setOptionsCsv(""); setType("text"); }, onError: (e: any) => setErr(e?.message ?? "Could not add field.") }
    );
  };

  const fields = data?.fields ?? [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Custom fields" subtitle="Extra fields on clients & leads" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Segmented
          options={[{ key: "investor", label: "Clients" }, { key: "lead", label: "Leads" }]}
          value={entity}
          onChange={(v) => setEntity(v as any)}
        />

        {/* Add */}
        <Text style={styles.section}>ADD A FIELD</Text>
        <Card>
          <TextField label="Field label" value={label} onChangeText={setLabel} placeholder="e.g. Preferred contact time" />
          <SelectField label="Type" value={type} options={CUSTOM_FIELD_TYPES} onChange={setType} />
          {type === "select" ? (
            <TextField label="Options (comma-separated)" value={optionsCsv} onChangeText={setOptionsCsv} placeholder="Morning, Afternoon, Evening" />
          ) : null}
          {err ? <Text variant="caption" style={{ color: palette.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
          <Button label="Add field" full loading={add.isPending} onPress={submit} icon={<Feather name="plus" size={16} color={palette.white} />} />
        </Card>

        {/* List */}
        <Text style={styles.section}>{entity === "investor" ? "CLIENT" : "LEAD"} FIELDS</Text>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : fields.length === 0 ? (
          <EmptyState icon="sliders" title="No custom fields yet" message="Add one above — it'll appear on the create/edit form." />
        ) : (
          <Card flat style={{ padding: 0 }}>
            {fields.map((f, i) => (
              <View key={f.id} style={[styles.row, i < fields.length - 1 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{f.label}</Text>
                  <Text variant="caption" tone="muted">
                    {titleCase(f.type)}{Array.isArray(f.options) && f.options.length ? ` · ${f.options.join(", ")}` : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmDelete({ title: "Delete field?", message: `Remove "${f.label}" from ${entity === "investor" ? "clients" : "leads"}.` }, () => del.mutate(f.id))}
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
  delBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
