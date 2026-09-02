/**
 * DateField — native date picker field. Stores the value as an ISO date string
 * ("YYYY-MM-DD") to match exactly what the web forms POST. Android shows the
 * platform dialog; iOS shows an inline spinner inside a bottom sheet.
 */

import React, { useState } from "react";
import { View, Pressable, Platform, StyleSheet } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";

function toISO(d: Date): string {
  // Local Y-M-D (avoid UTC shift that toISOString() introduces).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISO(s: string): Date {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? new Date() : d;
}

function pretty(s: string): string {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function DateField({
  label,
  value,
  onChange,
  required,
  error,
  max,
  placeholder = "Select date",
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  /** Max selectable date as ISO ("YYYY-MM-DD"). */
  max?: string;
  placeholder?: string;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(() => (value ? fromISO(value) : new Date()));

  const onAndroidChange = (e: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (e.type === "set" && d) onChange(toISO(d));
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Pressable
          style={[styles.control, error ? { borderColor: palette.danger } : null]}
          onPress={() => {
            setTemp(value ? fromISO(value) : new Date());
            setOpen(true);
          }}
        >
          <Text style={{ color: value ? palette.ink : palette.faint, fontSize: fontSize.md, flex: 1 }}>
            {value ? pretty(value) : placeholder}
          </Text>
          <Feather name="calendar" size={18} color={palette.faint} />
        </Pressable>
        {value ? (
          <Pressable style={styles.clear} onPress={() => onChange("")} hitSlop={8}>
            <Feather name="x" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>
      {help ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {help}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}

      {/* Android: fire the native dialog directly. */}
      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={temp}
          mode="date"
          display="default"
          maximumDate={max ? fromISO(max) : undefined}
          onChange={onAndroidChange}
        />
      ) : null}

      {/* iOS / web: inline spinner inside a sheet with a Done button. */}
      {Platform.OS !== "android" ? (
        <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
          <DateTimePicker
            value={temp}
            mode="date"
            display="spinner"
            maximumDate={max ? fromISO(max) : undefined}
            onChange={(_e, d) => d && setTemp(d)}
            style={{ alignSelf: "center" }}
          />
          <Button
            label="Done"
            full
            onPress={() => {
              onChange(toISO(temp));
              setOpen(false);
            }}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    height: 48,
    backgroundColor: palette.surface,
  },
  clear: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
});
