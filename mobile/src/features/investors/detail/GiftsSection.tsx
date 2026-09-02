/**
 * Birthday gifts & budget — set an annual gift budget, log gifts against it, and
 * track spend vs budget. Parity with the web ClientGifts.
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { Segmented } from "../../../components/ui/Segmented";
import { BottomSheet } from "../../../components/ui/BottomSheet";
import { DateField } from "../../../components/form/DateField";
import { Section, Empty } from "./primitives";
import { confirmDelete } from "../../../lib/confirm";
import { inr, fmtDate, titleCase } from "../../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { useGifts, useAddGift, useSetGiftBudget, useDeleteGift } from "./subfeatures";

const OCCASIONS = [
  { key: "birthday", label: "Birthday" },
  { key: "anniversary", label: "Anniversary" },
  { key: "festival", label: "Festival" },
  { key: "other", label: "Other" },
];
const todayISO = () => new Date().toISOString().slice(0, 10);

export function GiftsSection({ id }: { id: string }) {
  const { data } = useGifts(id);
  const addGift = useAddGift(id);
  const setBudget = useSetGiftBudget(id);
  const del = useDeleteGift(id);
  const [addOpen, setAddOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetStr, setBudgetStr] = useState("");

  const budget = data?.budget ?? 0;
  const spent = data?.spent ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  return (
    <Section title="Birthday gifts & budget" icon="gift" right={<Text variant="caption" tone="brand" onPress={() => { setBudgetStr(budget ? String(budget) : ""); setBudgetOpen(true); }}>Set budget</Text>}>
      <View style={styles.budgetHead}>
        <Text variant="caption" tone="muted">Spent {inr(spent)}{budget ? ` of ${inr(budget)}` : " (no budget set)"}</Text>
        <Button label="Add gift" size="sm" variant="secondary" icon={<Feather name="plus" size={13} color={palette.ink} />} onPress={() => setAddOpen(true)} />
      </View>
      {budget > 0 ? (
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: pct >= 100 ? palette.danger : palette.success }]} /></View>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        {(data?.gifts ?? []).length === 0 ? <Empty text="No gifts logged." /> : (data?.gifts ?? []).map((g) => (
          <View key={g.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium as any }} numberOfLines={1}>{g.title}</Text>
              <Text variant="caption" tone="faint">{titleCase(g.occasion)} · {fmtDate(g.givenOn)}</Text>
            </View>
            <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any }}>{inr(g.amount)}</Text>
            <Feather name="trash-2" size={13} color={palette.faint} onPress={() => confirmDelete({ title: `Delete “${g.title}”?`, confirmLabel: "Delete" }, () => del.mutate(g.id))} />
          </View>
        ))}
      </View>

      <AddGiftSheet visible={addOpen} onClose={() => setAddOpen(false)} onSubmit={(g) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); addGift.mutate(g, { onSuccess: () => setAddOpen(false) }); }} pending={addGift.isPending} />

      <BottomSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} title="Annual gift budget">
        <TextField label="Budget (₹)" value={budgetStr} onChangeText={setBudgetStr} keyboardType="numeric" />
        <View style={{ height: spacing.md }} />
        <Button label="Save budget" full loading={setBudget.isPending} onPress={() => setBudget.mutate(budgetStr.trim() ? Math.round(Number(budgetStr)) : null, { onSuccess: () => setBudgetOpen(false) })} />
      </BottomSheet>
    </Section>
  );
}

function AddGiftSheet({ visible, onClose, onSubmit, pending }: { visible: boolean; onClose: () => void; onSubmit: (g: any) => void; pending: boolean }) {
  const [occasion, setOccasion] = useState("birthday");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [givenOn, setGivenOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    onSubmit({ occasion, title: title.trim(), amount: Math.round(Number(amount) || 0), givenOn, notes: notes.trim() || undefined });
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Log a gift">
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Occasion</Text>
      <Segmented<string> options={OCCASIONS} value={occasion} onChange={setOccasion} />
      <View style={{ height: spacing.md }} />
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Sweet box, gift card…" required />
      <TextField label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <DateField label="Given on" value={givenOn} onChange={setGivenOn} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      <View style={{ height: spacing.md }} />
      <Button label="Add gift" full loading={pending} onPress={submit} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  budgetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
});
