/**
 * SelectField — labeled dropdown that opens a BottomSheet of options. The native
 * mobile replacement for a web <select>.
 */

import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";
import { Text } from "./Text";
import { BottomSheet } from "./BottomSheet";

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  required,
}: {
  label: string;
  value: string | null;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { brand, brandDark } = useBrand();
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <Pressable style={styles.control} onPress={() => setOpen(true)}>
        <Text style={{ color: selected ? palette.ink : palette.faint, fontSize: fontSize.md, flex: 1 }}>
          {selected?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={palette.faint} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={{ gap: spacing.xs }}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              style={styles.option}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <Text variant="body" style={{ color: o.value === value ? brandDark : palette.ink }}>
                {o.label}
              </Text>
              {o.value === value ? <Feather name="check" size={18} color={brand} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    height: 48,
    backgroundColor: palette.surface,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
});
