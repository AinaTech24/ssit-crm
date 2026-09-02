/**
 * Quick-Comms dispatcher — pick an approved template, fill its variables (typed
 * inputs), and send via the comms pipeline. Parity with the web QuickCommsPanel.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, Pressable, Switch, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { BottomSheet } from "../../../components/ui/BottomSheet";
import { DateField } from "../../../components/form/DateField";
import { EmptyState } from "../../../components/states";
import { titleCase } from "../../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useInvestorTemplates, useDispatchComm, type CommSubject } from "../api";

interface TVar { key: string; type: string; required?: boolean }
interface Template { id: string; key: string; channel: string; name: string; description?: string; category?: string; variables?: TVar[] }
const chIcon = (c: string) => (c === "whatsapp" ? "message-circle" : c === "email" ? "mail" : "message-square");

export function QuickCommsSheet({
  id, visible, onClose, subject = "investor",
}: {
  id: string;
  visible: boolean;
  onClose: () => void;
  /** Prospects get template sends too — the route differs, the UI doesn't. */
  subject?: CommSubject;
}) {
  const { data, isLoading } = useInvestorTemplates(id, visible, subject);
  const dispatch = useDispatchComm(id, subject);
  const [selected, setSelected] = useState<Template | null>(null);
  const [vars, setVars] = useState<Record<string, any>>({});

  const templates: Template[] = Array.isArray(data) ? data : data?.templates ?? [];
  const missingRequired = useMemo(
    () => (selected?.variables ?? []).some((v) => v.required && !String(vars[v.key] ?? "").trim()),
    [selected, vars]
  );

  const close = () => { setSelected(null); setVars({}); onClose(); };
  const pick = (t: Template) => {
    setSelected(t);
    const init: Record<string, any> = {};
    (t.variables ?? []).forEach((v) => { init[v.key] = v.type === "boolean" ? false : ""; });
    setVars(init);
  };
  const send = () => {
    if (!selected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    dispatch.mutate(
      { channel: selected.channel, templateKey: selected.key, variables: vars },
      { onSuccess: close }
    );
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={selected ? selected.name : "Quick comms"}>
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        {!selected ? (
          isLoading ? <Text tone="muted">Loading templates…</Text>
          : templates.length === 0 ? <EmptyState icon="send" title="No approved templates" message="Approve templates in the Templates module to send from here." />
          : templates.map((t) => (
            <Pressable key={t.id ?? t.key} style={styles.tRow} onPress={() => pick(t)}>
              <Feather name={chIcon(t.channel) as any} size={16} color={palette.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{t.name}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{[titleCase(t.channel), titleCase(t.category)].filter(Boolean).join(" · ")}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.faint} />
            </Pressable>
          ))
        ) : (
          <View>
            <Pressable onPress={() => setSelected(null)} style={styles.back}><Feather name="chevron-left" size={16} color={palette.brand} /><Text variant="caption" style={{ color: palette.brand }}>All templates</Text></Pressable>
            {(selected.variables ?? []).length === 0 ? (
              <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>No variables — ready to send.</Text>
            ) : (selected.variables ?? []).map((v) => (
              <VarInput key={v.key} v={v} value={vars[v.key]} onChange={(val) => setVars((s) => ({ ...s, [v.key]: val }))} />
            ))}
            <View style={{ height: spacing.md }} />
            <Button label={`Send ${titleCase(selected.channel)}`} full loading={dispatch.isPending} disabled={missingRequired} onPress={send} icon={<Feather name="send" size={15} color="#fff" />} />
            {dispatch.isError ? <Text variant="caption" style={{ color: palette.danger, marginTop: spacing.sm }}>{(dispatch.error as any)?.message ?? "Send failed."}</Text> : null}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

function VarInput({ v, value, onChange }: { v: TVar; value: any; onChange: (val: any) => void }) {
  const label = titleCase(v.key) + (v.required ? " *" : "");
  if (v.type === "date") return <DateField label={label} value={value ?? ""} onChange={onChange} />;
  if (v.type === "boolean") {
    return (
      <View style={styles.switchRow}>
        <Text style={{ flex: 1 }}>{label}</Text>
        <Switch value={!!value} onValueChange={onChange} trackColor={{ true: palette.brand }} />
      </View>
    );
  }
  const numeric = v.type === "number" || v.type === "currency";
  return <TextField label={label} value={String(value ?? "")} onChangeText={onChange} keyboardType={numeric ? "numeric" : "default"} />;
}

const styles = StyleSheet.create({
  tRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  back: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
});
