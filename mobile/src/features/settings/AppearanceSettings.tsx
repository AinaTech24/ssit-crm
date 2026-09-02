/**
 * Appearance & theme — parity with web /dashboard/settings/appearance. Tenant-
 * level (firm-wide): preset palettes, custom brand colours (hex), font & density.
 * Owner-only save (settings.users); others see it read-only. PATCH /api/tenant.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useTenant, useSaveTheme, THEME_PRESETS, THEME_FONTS, UI_DENSITIES } from "./api";

const DEFAULTS = { primary: "#0e2557", accent: "#0ea5e9", text: "#0f172a", hover: "#f1f5f9", font: "inter", density: "comfortable" };
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
const normHex = (v: string) => {
  let s = v.toUpperCase().replace(/[^#0-9A-F]/g, "");
  if (!s.startsWith("#")) s = "#" + s;
  return s.slice(0, 7);
};

export function AppearanceSettings() {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data: tenantData, isLoading, isError, refetch } = useTenant();
  const save = useSaveTheme();
  const tenant = tenantData?.tenant ?? tenantData;

  const initial = useMemo(
    () => ({
      primary: isHex(tenant?.primaryColor ?? "") ? tenant.primaryColor : DEFAULTS.primary,
      accent: isHex(tenant?.secondaryColor ?? "") ? tenant.secondaryColor : DEFAULTS.accent,
      text: isHex(tenant?.textColor ?? "") ? tenant.textColor : DEFAULTS.text,
      hover: isHex(tenant?.hoverColor ?? "") ? tenant.hoverColor : DEFAULTS.hover,
      font: tenant?.fontFamily || DEFAULTS.font,
      density: tenant?.uiDensity || DEFAULTS.density,
    }),
    [tenant]
  );

  const [v, setV] = useState<typeof DEFAULTS | null>(null);
  const state = v ?? initial;
  const set = (k: keyof typeof DEFAULTS, val: string) => setV({ ...state, [k]: val });

  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Appearance & theme" /><LoadingState /></View>;
  if (isError) return <View style={styles.screen}><ScreenHeader title="Appearance & theme" /><ErrorState onRetry={refetch} /></View>;

  const dirty =
    state.primary !== initial.primary || state.accent !== initial.accent || state.text !== initial.text ||
    state.hover !== initial.hover || state.font !== initial.font || state.density !== initial.density;
  const colorsValid = [state.primary, state.accent, state.text, state.hover].every(isHex);

  const onSave = () => {
    setMsg(null);
    save.mutate(
      { primaryColor: state.primary, secondaryColor: state.accent, textColor: state.text, hoverColor: state.hover, fontFamily: state.font, uiDensity: state.density },
      { onSuccess: () => setMsg("Saved — applied across the CRM."), onError: (e: any) => setMsg(e?.message ?? "Could not save.") }
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Appearance & theme" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Live preview */}
        <View style={[styles.preview, { backgroundColor: isHex(state.primary) ? state.primary : DEFAULTS.primary }]}>
          <Text style={{ color: palette.white, fontWeight: fontWeight.bold as any }}>{tenant?.displayName ?? "Your firm"}</Text>
          <View style={[styles.previewBtn, { backgroundColor: isHex(state.accent) ? state.accent : DEFAULTS.accent }]}>
            <Text style={{ color: palette.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold as any }}>Accent button</Text>
          </View>
        </View>

        {!canEdit ? (
          <View style={styles.readonly}>
            <Feather name="info" size={14} color={palette.muted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>Only the firm owner can change the theme. Shown read-only.</Text>
          </View>
        ) : null}

        {/* Presets */}
        <Text style={styles.section}>PRESET PALETTES</Text>
        <View style={styles.presetGrid}>
          {THEME_PRESETS.map((p) => {
            const active = state.primary.toLowerCase() === p.primary && state.accent.toLowerCase() === p.accent;
            return (
              <Pressable key={p.key} disabled={!canEdit} style={[styles.preset, active && { borderColor: palette.brand, borderWidth: 2 }]} onPress={() => setV({ ...state, primary: p.primary, accent: p.accent })}>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <View style={[styles.sw, { backgroundColor: p.primary }]} />
                  <View style={[styles.sw, { backgroundColor: p.accent }]} />
                </View>
                <Text variant="caption" style={{ marginTop: 4 }}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Custom colours */}
        <Text style={styles.section}>CUSTOM COLOURS</Text>
        <Card>
          <HexRow label="Primary (chrome)" value={state.primary} onChange={(t) => set("primary", normHex(t))} disabled={!canEdit} />
          <HexRow label="Accent (highlights)" value={state.accent} onChange={(t) => set("accent", normHex(t))} disabled={!canEdit} />
          <HexRow label="Text colour" value={state.text} onChange={(t) => set("text", normHex(t))} disabled={!canEdit} />
          <HexRow label="Hover colour" value={state.hover} onChange={(t) => set("hover", normHex(t))} disabled={!canEdit} last />
        </Card>

        {/* Typography & density */}
        <Text style={styles.section}>TYPOGRAPHY & DENSITY</Text>
        <Card>
          <SelectField label="Font" value={state.font} options={THEME_FONTS} onChange={(val) => set("font", val)} />
          <SelectField label="Density" value={state.density} options={UI_DENSITIES} onChange={(val) => set("density", val)} />
          <Text variant="caption" tone="muted">Applies across the whole workspace for your firm. Compact tightens text & spacing.</Text>
        </Card>

        {msg ? <Text variant="caption" style={{ color: msg.startsWith("Saved") ? palette.success : palette.danger, marginTop: spacing.md }}>{msg}</Text> : null}

        {canEdit ? (
          <View style={{ marginTop: spacing.lg, flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><Button label="Reset" variant="secondary" full onPress={() => setV({ ...DEFAULTS })} /></View>
            <View style={{ flex: 2 }}><Button label="Save theme" full disabled={!dirty || !colorsValid} loading={save.isPending} onPress={onSave} /></View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function HexRow({ label, value, onChange, disabled, last }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; last?: boolean }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md }, !last && { marginBottom: spacing.md }]}>
      <View style={[styles.swBig, { backgroundColor: /^#[0-9a-fA-F]{6}$/.test(value) ? value : palette.line }]} />
      <View style={{ flex: 1 }}>
        <TextField label={label} value={value} onChangeText={disabled ? () => {} : onChange} autoCapitalize="characters" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  preview: { borderRadius: radius.lg, padding: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  previewBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  readonly: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, backgroundColor: palette.surfaceSunken, borderRadius: radius.md },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  preset: { width: "31%", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" },
  sw: { width: 20, height: 20, borderRadius: 5 },
  swBig: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: palette.line, marginBottom: spacing.md },
});
