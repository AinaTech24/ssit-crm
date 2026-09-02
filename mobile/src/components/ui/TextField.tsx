/**
 * TextField — labeled text input for forms. Supports multiline, an error line,
 * and a required marker. Native keyboard types via `keyboardType`.
 */

import React from "react";
import { View, TextInput, StyleSheet, type KeyboardTypeOptions } from "react-native";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { Text } from "./Text";

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  required,
  error,
  keyboardType,
  autoCapitalize = "sentences",
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, multiline && styles.multiline, error && { borderColor: palette.danger }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.faint}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: spacing.md },
});
