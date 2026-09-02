/**
 * AudienceField — the campaign audience builder, natively. Resolves a
 * `segmentId` (the only value the campaign POST needs) via one of four modes:
 *   All clients / All leads  → POST /api/segments/adhoc {mode:"all"}
 *   Specific clients         → pick via /api/search, POST adhoc {mode:"manual"}
 *   Existing segment         → GET /api/segments, use the picked id directly
 * ("By criteria" filter-AST mode is deferred — matches the analyst's guidance.)
 *
 * Stores the resolved segmentId in the form; keeps label/count locally for the
 * green "N recipients" confirmation, mirroring the web builder.
 */

import React, { useState } from "react";
import { View, Pressable, TextInput, ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api, ApiError } from "../../api/client";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/SelectField";
import type { FieldSpec } from "../../features/forms/types";

const MODES = [
  { key: "all_clients", label: "All clients" },
  { key: "all_leads", label: "All leads" },
  { key: "specific", label: "Specific clients" },
  { key: "existing", label: "Existing segment" },
];

export function AudienceField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<string>("all_clients");
  const [label, setLabel] = useState<string>("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Specific clients" picker state
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([]);
  const searchQ = useQuery({
    queryKey: ["audience-search", term.trim()],
    enabled: mode === "specific" && term.trim().length >= 2,
    queryFn: () => api.get<any>("/api/search", { q: term.trim() }),
    staleTime: 30_000,
  });
  const searchRows: any[] = (searchQ.data?.investors ?? []) as any[];

  // "Existing segment" list
  const segQ = useQuery({
    queryKey: ["segments-list"],
    enabled: mode === "existing",
    queryFn: () => api.get<any>("/api/segments"),
    staleTime: 60_000,
  });
  const segments: any[] = (segQ.data?.segments ?? []) as any[];

  const resolve = async (body: any, lbl: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ segmentId: string; memberCount: number }>("/api/segments/adhoc", body);
      onChange(res.segmentId);
      setLabel(lbl);
      setCount(res.memberCount ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resolve that audience.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    onChange("");
    setLabel("");
    setCount(null);
    setPicked([]);
    setError(null);
  };

  // Resolved state — green confirmation box.
  if (value) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {field.label}
        </Text>
        <View style={styles.resolved}>
          <Feather name="users" size={16} color={palette.success} />
          <View style={{ flex: 1 }}>
            <Text variant="body" style={{ color: palette.success }}>
              {label || "Audience set"}
            </Text>
            {count != null ? (
              <Text variant="caption" tone="muted">
                {count} recipient{count === 1 ? "" : "s"} will receive this
              </Text>
            ) : null}
          </View>
          <Pressable onPress={reset} hitSlop={8}>
            <Text variant="label" style={{ color: palette.brand }}>
              Change
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {field.label}
      </Text>

      <View style={styles.modeRow}>
        {MODES.map((m) => (
          <Chip key={m.key} label={m.label} selected={mode === m.key} onPress={() => { setMode(m.key); setError(null); }} />
        ))}
      </View>

      {mode === "all_clients" ? (
        <Button label="Use all clients" variant="secondary" loading={busy} onPress={() => resolve({ subjectType: "investor", mode: "all", name: "All clients" }, "All clients")} />
      ) : null}

      {mode === "all_leads" ? (
        <Button label="Use all leads" variant="secondary" loading={busy} onPress={() => resolve({ subjectType: "lead", mode: "all", name: "All leads" }, "All leads")} />
      ) : null}

      {mode === "existing" ? (
        segQ.isLoading ? (
          <Text tone="muted" variant="body">Loading segments…</Text>
        ) : segments.length === 0 ? (
          <Text tone="muted" variant="caption">No saved segments yet.</Text>
        ) : (
          <SelectField
            label=""
            value=""
            placeholder="Select a segment…"
            options={segments.map((s) => ({ value: s.id, label: `${s.name} (${s.memberCount ?? 0} members)` }))}
            onChange={(id) => {
              const seg = segments.find((s) => s.id === id);
              if (seg) { onChange(seg.id); setLabel(seg.name); setCount(seg.memberCount ?? null); }
            }}
          />
        )
      ) : null}

      {mode === "specific" ? (
        <View>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={palette.faint} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Search clients by name, PAN, mobile…"
              placeholderTextColor={palette.faint}
              style={styles.searchInput}
            />
            {searchQ.isFetching ? <ActivityIndicator size="small" color={palette.brand} /> : null}
          </View>
          {picked.length ? (
            <View style={styles.chipsWrap}>
              {picked.map((p) => (
                <Chip key={p.id} label={`${p.name}  ✕`} selected onPress={() => setPicked((s) => s.filter((x) => x.id !== p.id))} />
              ))}
            </View>
          ) : null}
          {term.trim().length >= 2 && searchRows.length ? (
            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
              {searchRows.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.row}
                  onPress={() => {
                    setPicked((s) => (s.some((x) => x.id === r.id) ? s : [...s, { id: r.id, name: r.name }]));
                    setTerm("");
                  }}
                >
                  <Text variant="body">{r.name}</Text>
                  <Text variant="caption" tone="muted">{[r.pan, r.phone].filter(Boolean).join(" · ")}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label={`Set audience (${picked.length})`}
              variant="secondary"
              loading={busy}
              disabled={picked.length === 0}
              onPress={() => resolve({ subjectType: "investor", mode: "manual", subjectIds: picked.map((p) => p.id), name: "Selected clients" }, `${picked.length} selected client${picked.length === 1 ? "" : "s"}`)}
            />
          </View>
        </View>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: spacing.sm, color: palette.danger }}>
          {error}
        </Text>
      ) : null}
      {field.help ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {field.help}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  resolved: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.success,
    backgroundColor: palette.successBg,
    borderRadius: radius.md,
    padding: spacing.md,
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
    backgroundColor: palette.surface,
  },
  searchInput: { flex: 1, fontSize: fontSize.md, color: palette.ink, paddingVertical: 0 },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.lineSoft,
  },
});
