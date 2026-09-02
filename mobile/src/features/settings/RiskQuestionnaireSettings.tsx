/**
 * Risk profile questionnaire editor — parity with web /dashboard/settings/
 * risk-profile. Customise the questions, per-option scores, and risk-category
 * bands used by the Risk Profile wizard. GET/POST /api/risk-profile-template.
 */

import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { LoadingState, ErrorState } from "../../components/states";
import { useMe, hasCap } from "../../api/me";
import { confirmDelete } from "../../lib/confirm";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useRiskTemplate, useSaveRiskTemplate } from "./api";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

interface Opt { value?: string; label: string; score: string }
interface Q { key?: string; label: string; helperText: string; options: Opt[] }
interface Band { id?: string; label: string; minScore: string; maxScore: string; color: string; description: string }

export function RiskQuestionnaireSettings() {
  const router = useRouter();
  const { data: me } = useMe();
  const canEdit = hasCap(me?.capabilities, "settings.users");
  const { data, isLoading, isError, refetch } = useRiskTemplate();
  const save = useSaveRiskTemplate();

  const [name, setName] = useState("");
  const [interval, setInterval] = useState("365");
  const [questions, setQuestions] = useState<Q[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (ready || !data?.template) return;
    const t = data.template;
    setName(t.name ?? "");
    setInterval(String(t.reviewIntervalDays ?? 365));
    setQuestions((t.questions ?? []).map((q: any) => ({
      key: q.key, label: q.label ?? "", helperText: q.helperText ?? "",
      options: (q.options ?? []).map((o: any) => ({ value: o.value, label: o.label ?? "", score: String(o.score ?? 0) })),
    })));
    setBands((t.bands ?? []).map((b: any) => ({ id: b.id, label: b.label ?? "", minScore: String(b.minScore ?? 0), maxScore: String(b.maxScore ?? 0), color: b.color ?? "#0ea5e9", description: b.description ?? "" })));
    setReady(true);
  }, [data, ready]);

  if (isLoading || !ready) return <View style={styles.screen}><ScreenHeader title="Risk questionnaire" />{isError ? <ErrorState onRetry={refetch} /> : <LoadingState />}</View>;

  const setQ = (i: number, patch: Partial<Q>) => setQuestions((s) => s.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const setOpt = (qi: number, oi: number, patch: Partial<Opt>) => setQuestions((s) => s.map((q, idx) => idx === qi ? { ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : q));
  const setB = (i: number, patch: Partial<Band>) => setBands((s) => s.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const onSave = () => {
    setMsg(null);
    const tpl = {
      name: name.trim() || "Risk profile",
      reviewIntervalDays: Number(interval) || 365,
      questions: questions.filter((q) => q.label.trim()).map((q, qi) => ({
        key: q.key || slug(q.label) || `q${qi}`,
        label: q.label.trim(),
        helperText: q.helperText.trim() || undefined,
        type: "single",
        options: q.options.filter((o) => o.label.trim()).map((o) => ({ value: o.value || slug(o.label) || "opt", label: o.label.trim(), score: Number(o.score) || 0 })),
      })),
      bands: bands.filter((b) => b.label.trim()).map((b) => ({ id: b.id || slug(b.label), label: b.label.trim(), minScore: Number(b.minScore) || 0, maxScore: Number(b.maxScore) || 0, color: b.color || undefined, description: b.description.trim() || undefined })),
    };
    save.mutate(tpl, { onSuccess: () => setMsg("Saved."), onError: (e: any) => setMsg(e?.message ?? "Could not save — check band coverage & unique questions.") });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Risk questionnaire" subtitle="Questions, scoring & bands" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!canEdit ? <Card flat style={{ marginBottom: spacing.md }}><Text variant="caption" tone="muted">Only the firm owner can edit this. Shown read-only.</Text></Card> : null}

        <Card>
          <TextField label="Questionnaire name" value={name} onChangeText={setName} />
          <TextField label="Review interval (days)" value={interval} onChangeText={(v) => setInterval(v.replace(/\D/g, ""))} keyboardType="number-pad" />
        </Card>

        <Text style={styles.section}>QUESTIONS</Text>
        {questions.map((q, qi) => (
          <Card key={qi} style={{ marginBottom: spacing.md }}>
            <View style={styles.head}>
              <Text variant="label" tone="muted">Question {qi + 1}</Text>
              {canEdit ? <Pressable onPress={() => confirmDelete({ title: "Remove question?", message: q.label || `Question ${qi + 1}` }, () => setQuestions((s) => s.filter((_, i) => i !== qi)))} hitSlop={8}><Feather name="trash-2" size={15} color={palette.danger} /></Pressable> : null}
            </View>
            <TextField label="Label" value={q.label} onChangeText={(v) => setQ(qi, { label: v })} />
            <TextField label="Helper text (optional)" value={q.helperText} onChangeText={(v) => setQ(qi, { helperText: v })} />
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Options (answer · score)</Text>
            {q.options.map((o, oi) => (
              <View key={oi} style={styles.optRow}>
                <View style={{ flex: 3 }}><TextField label="" value={o.label} onChangeText={(v) => setOpt(qi, oi, { label: v })} placeholder="Answer" /></View>
                <View style={{ flex: 1 }}><TextField label="" value={o.score} onChangeText={(v) => setOpt(qi, oi, { score: v.replace(/[^0-9-]/g, "") })} keyboardType="number-pad" placeholder="0" /></View>
                {canEdit ? <Pressable onPress={() => setQ(qi, { options: q.options.filter((_, j) => j !== oi) })} hitSlop={6} style={{ paddingBottom: 22 }}><Feather name="x" size={16} color={palette.muted} /></Pressable> : null}
              </View>
            ))}
            {canEdit ? <Button label="Add option" variant="secondary" size="sm" onPress={() => setQ(qi, { options: [...q.options, { label: "", score: "0" }] })} /> : null}
          </Card>
        ))}
        {canEdit ? <Button label="Add question" variant="secondary" onPress={() => setQuestions((s) => [...s, { label: "", helperText: "", options: [{ label: "", score: "0" }] }])} icon={<Feather name="plus" size={16} color={palette.ink} />} /> : null}

        <Text style={styles.section}>RISK BANDS</Text>
        {bands.map((b, bi) => (
          <Card key={bi} style={{ marginBottom: spacing.md }}>
            <View style={styles.head}>
              <View style={[styles.swatch, { backgroundColor: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : palette.line }]} />
              <Text variant="label" tone="muted" style={{ flex: 1 }}>Band {bi + 1}</Text>
              {canEdit ? <Pressable onPress={() => confirmDelete({ title: "Remove band?", message: b.label || `Band ${bi + 1}` }, () => setBands((s) => s.filter((_, i) => i !== bi)))} hitSlop={8}><Feather name="trash-2" size={15} color={palette.danger} /></Pressable> : null}
            </View>
            <TextField label="Label" value={b.label} onChangeText={(v) => setB(bi, { label: v })} placeholder="e.g. Conservative" />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}><TextField label="Min score" value={b.minScore} onChangeText={(v) => setB(bi, { minScore: v.replace(/\D/g, "") })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><TextField label="Max score" value={b.maxScore} onChangeText={(v) => setB(bi, { maxScore: v.replace(/\D/g, "") })} keyboardType="number-pad" /></View>
            </View>
            <TextField label="Colour (hex)" value={b.color} onChangeText={(v) => setB(bi, { color: v })} autoCapitalize="none" />
            <TextField label="Description (optional)" value={b.description} onChangeText={(v) => setB(bi, { description: v })} />
          </Card>
        ))}
        {canEdit ? <Button label="Add band" variant="secondary" onPress={() => setBands((s) => [...s, { label: "", minScore: "0", maxScore: "0", color: "#0ea5e9", description: "" }])} icon={<Feather name="plus" size={16} color={palette.ink} />} /> : null}

        {msg ? <Text variant="caption" style={{ color: msg === "Saved." ? palette.success : palette.danger, marginTop: spacing.md }}>{msg}</Text> : null}
        {canEdit ? <Button label="Save questionnaire" full style={{ marginTop: spacing.lg }} loading={save.isPending} onPress={onSave} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  swatch: { width: 18, height: 18, borderRadius: 5 },
});
