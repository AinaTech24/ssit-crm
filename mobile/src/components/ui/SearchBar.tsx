/**
 * SearchBar — debounced search input used on every list screen. Controlled
 * value + onChangeText; the parent debounces before hitting the API.
 */

import React from "react";
import { View, TextInput, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search…",
  autoFocus = false,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Opens the keyboard with the screen — for the dedicated search screen, where
   *  typing is the only reason the user is there. Leave off inside lists. */
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Feather name="search" size={18} color={palette.faint} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.faint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={autoFocus}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10}>
          <Feather name="x" size={18} color={palette.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  input: { flex: 1, fontSize: fontSize.md, color: palette.ink, padding: 0 },
});
