/**
 * TypeaheadField — search-as-you-type picker. Opens a bottom sheet with a search
 * box; debounced queries hit an endpoint (e.g. /api/search?q=…) and results are
 * tappable. The native replacement for the web InvestorLookup / client pickers,
 * for books too large to list in a plain dropdown.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, TextInput, ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { BottomSheet } from "../ui/BottomSheet";
import type { FieldSpec } from "../../features/forms/types";

export function TypeaheadField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>("");

  const minChars = field.searchMinChars ?? 2;
  const param = field.searchParam ?? "q";
  const envelope = field.searchEnvelope ?? "results";
  const getValue = field.searchValue ?? ((r: any) => String(r.id));
  const getLabel = field.searchLabel ?? ((r: any) => r.name ?? r.title ?? String(r.id));

  // Debounce the search term (300ms) so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const enabled = open && debounced.length >= minChars;
  const { data, isFetching } = useQuery({
    queryKey: ["typeahead", field.searchEndpoint, envelope, debounced, field.searchExtraParams],
    enabled,
    queryFn: () =>
      api.get<any>(field.searchEndpoint!, { [param]: debounced, ...(field.searchExtraParams ?? {}) }),
    staleTime: 30_000,
  });
  const rows: any[] = (data && (data[envelope] ?? [])) || [];

  const pick = (row: any) => {
    onChange(getValue(row));
    setSelectedLabel(getLabel(row));
    setOpen(false);
    setTerm("");
    setDebounced("");
  };

  const clear = () => {
    onChange("");
    setSelectedLabel("");
  };

  const display = value ? selectedLabel || "Selected" : field.placeholder ?? "Search…";

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {field.label}
        {field.required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Pressable style={styles.control} onPress={() => setOpen(true)}>
          <Feather name="search" size={16} color={palette.faint} />
          <Text style={{ color: value ? palette.ink : palette.faint, fontSize: fontSize.md, flex: 1 }} numberOfLines={1}>
            {display}
          </Text>
        </Pressable>
        {value ? (
          <Pressable style={styles.clear} onPress={clear} hitSlop={8}>
            <Feather name="x" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>
      {field.help ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {field.help}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={field.label}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={palette.faint} />
          <TextInput
            autoFocus
            value={term}
            onChangeText={setTerm}
            placeholder={field.placeholder ?? "Type to search…"}
            placeholderTextColor={palette.faint}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {isFetching ? <ActivityIndicator size="small" color={palette.brand} /> : null}
        </View>

        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {debounced.length < minChars ? (
            <Text tone="muted" variant="caption" style={styles.hint}>
              Type at least {minChars} characters to search.
            </Text>
          ) : rows.length === 0 && !isFetching ? (
            <Text tone="muted" variant="caption" style={styles.hint}>
              No matches for “{debounced}”.
            </Text>
          ) : (
            rows.map((r) => {
              const val = getValue(r);
              return (
                <Pressable key={val} style={styles.row} onPress={() => pick(r)}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={1}>
                      {getLabel(r)}
                    </Text>
                    {field.searchSublabel ? (
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {field.searchSublabel(r)}
                      </Text>
                    ) : null}
                  </View>
                  {val === value ? <Feather name="check" size={18} color={palette.brand} /> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    backgroundColor: palette.surfaceAlt,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: fontSize.md, color: palette.ink, paddingVertical: 0 },
  hint: { paddingVertical: spacing.lg, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.lineSoft,
  },
});
