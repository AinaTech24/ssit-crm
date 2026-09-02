/**
 * FieldRenderer — turns one FieldSpec into the right native control. Central
 * dispatch used by FormScreen (and, recursively, by repeater sub-fields).
 */

import React from "react";
import { View, Switch, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { SelectField } from "../ui/SelectField";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { DateField } from "./DateField";
import { LookupField } from "./LookupField";
import { TypeaheadField } from "./TypeaheadField";
import { AudienceField } from "./AudienceField";
import type { FieldSpec, Option } from "../../features/forms/types";

const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

function normOptions(opts?: Array<string | Option>): Option[] {
  return (opts ?? []).map((o) => (typeof o === "string" ? { value: o, label: o || "Select" } : o));
}

export function FieldRenderer({
  field,
  value,
  error,
  onChange,
  form,
}: {
  field: FieldSpec;
  value: any;
  error?: string;
  onChange: (v: any) => void;
  form?: Record<string, any>;
}) {
  const type = field.type ?? "text";

  const apply = (v: string) => onChange(field.transform ? field.transform(v) : v);

  switch (type) {
    case "select":
      return (
        <SelectField
          label={field.label}
          value={value ?? ""}
          options={normOptions(field.options)}
          onChange={apply}
          placeholder={field.placeholder}
          required={field.required}
        />
      );

    case "date":
      return (
        <DateField
          label={field.label}
          value={value ?? ""}
          onChange={onChange}
          required={field.required}
          error={error}
          max={field.maxToday ? TODAY : undefined}
          placeholder={field.placeholder}
          help={field.help}
        />
      );

    case "lookup":
      return <LookupField field={field} value={value ?? ""} onChange={onChange} form={form} />;

    case "typeahead":
      return <TypeaheadField field={field} value={value ?? ""} onChange={onChange} />;

    case "audience":
      return <AudienceField field={field} value={value ?? ""} onChange={onChange} />;

    case "switch":
      return (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text variant="body">{field.label}</Text>
            {field.help ? (
              <Text variant="caption" tone="muted">
                {field.help}
              </Text>
            ) : null}
          </View>
          <Switch
            value={!!value}
            onValueChange={onChange}
            trackColor={{ true: palette.brand, false: palette.line }}
            thumbColor={palette.white}
          />
        </View>
      );

    case "readonly": {
      const text = field.format ? field.format(value, form ?? {}) : String(value ?? "—");
      return (
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            {field.label}
          </Text>
          <View style={styles.readonly}>
            <Text variant="body">{text}</Text>
          </View>
          {field.help ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {field.help}
            </Text>
          ) : null}
        </View>
      );
    }

    case "multiselect": {
      const selected: string[] = Array.isArray(value) ? value : [];
      const opts = normOptions(field.options).filter((o) => o.value !== "");
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
      return (
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            {field.label}
            {field.required ? <Text style={{ color: palette.danger }}> *</Text> : null}
          </Text>
          <View style={styles.chips}>
            {opts.map((o) => (
              <Chip key={o.value} label={o.label} selected={selected.includes(o.value)} onPress={() => toggle(o.value)} />
            ))}
          </View>
          {field.help ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {field.help}
            </Text>
          ) : null}
          {error ? (
            <Text variant="caption" tone="danger" style={{ marginTop: 4, color: palette.danger }}>
              {error}
            </Text>
          ) : null}
        </View>
      );
    }

    case "repeater":
      return <RepeaterField field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;

    case "textarea":
      return (
        <TextField
          label={field.label}
          value={value ?? ""}
          onChangeText={apply}
          placeholder={field.placeholder}
          required={field.required}
          error={error}
          multiline
        />
      );

    default:
      // text / email / tel / number
      return (
        <TextField
          label={field.label}
          value={value ?? ""}
          onChangeText={apply}
          placeholder={field.placeholder}
          required={field.required}
          error={error}
          keyboardType={
            field.keyboard ??
            (type === "email"
              ? "email-address"
              : type === "tel"
              ? "phone-pad"
              : type === "number"
              ? "decimal-pad"
              : "default")
          }
          autoCapitalize={field.autoCapitalize ?? (type === "email" ? "none" : "sentences")}
        />
      );
  }
}

/** RepeaterField — add/remove rows of a fixed sub-form (nominees, referrals). */
function RepeaterField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: any[];
  onChange: (v: any[]) => void;
}) {
  const sub = field.itemFields ?? [];

  const addRow = () => {
    const blank: Record<string, any> = {};
    for (const f of sub) blank[f.key] = f.type === "switch" ? false : "";
    onChange([...value, blank]);
  };
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const setCell = (i: number, key: string, v: any) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));

  return (
    <View>
      {value.map((row, i) => (
        <View key={i} style={styles.repItem}>
          <View style={styles.repHeader}>
            <Text variant="label" tone="muted">
              {field.itemTitle ? field.itemTitle(row, i) : `#${i + 1}`}
            </Text>
            <Pressable onPress={() => removeRow(i)} hitSlop={8}>
              <Feather name="trash-2" size={16} color={palette.danger} />
            </Pressable>
          </View>
          {sub
            .filter((f) => !f.visibleIf || f.visibleIf(row))
            .map((f) => (
              <FieldRenderer
                key={f.key}
                field={f}
                value={row[f.key]}
                onChange={(v) => setCell(i, f.key, v)}
                form={row}
              />
            ))}
        </View>
      ))}
      <Button
        label={field.addLabel ?? "Add"}
        variant="secondary"
        onPress={addRow}
        icon={<Feather name="plus" size={16} color={palette.ink} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  readonly: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.surfaceAlt,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  repItem: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: palette.surfaceAlt,
  },
  repHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
});
