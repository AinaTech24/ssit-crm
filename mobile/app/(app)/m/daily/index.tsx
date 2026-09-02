/**
 * Daily Plan (Job Tracker) — the MFD's morning-plan / evening-reflect ritual.
 * Morning: pick "Today's focus" (type your own or pull from due-today tasks),
 * check them off as the day goes. Evening: one key learning, one breakthrough,
 * one breakdown. Yesterday's completed/carried-over tasks + productivity % are
 * shown for context. One screen, auto-saved on change (debounced) + a Save button.
 */

import React from "react";
import { View, Pressable, TextInput, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { TextField } from "../../../../src/components/ui/TextField";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { useDailyTracker, useSaveDailyTracker, isoDay, type FocusItem } from "../../../../src/features/daily/api";
import { toast } from "../../../../src/lib/toast";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral" };

export default function DailyPlan() {
  const today = React.useMemo(() => isoDay(new Date()), []);
  const { data, isLoading } = useDailyTracker(today);
  const save = useSaveDailyTracker();

  const [focus, setFocus] = React.useState<FocusItem[]>([]);
  const [learning, setLearning] = React.useState("");
  const [breakthrough, setBreakthrough] = React.useState("");
  const [breakdown, setBreakdown] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const seeded = React.useRef(false);

  // Seed local state once from the server payload.
  React.useEffect(() => {
    if (data && !seeded.current) {
      setFocus(data.todayFocus ?? []);
      setLearning(data.keyLearning ?? "");
      setBreakthrough(data.breakthrough ?? "");
      setBreakdown(data.breakdown ?? "");
      seeded.current = true;
    }
  }, [data]);

  const persist = (next?: Partial<{ focus: FocusItem[]; learning: string; breakthrough: string; breakdown: string }>) => {
    save.mutate({
      date: today,
      todayFocus: next?.focus ?? focus,
      keyLearning: next?.learning ?? learning,
      breakthrough: next?.breakthrough ?? breakthrough,
      breakdown: next?.breakdown ?? breakdown,
    });
  };

  const addFocus = (text: string, taskId?: string) => {
    const t = text.trim();
    if (!t) return;
    const next = [...focus, { text: t, taskId, done: false }];
    setFocus(next); setDraft(""); persist({ focus: next });
  };
  const toggleFocus = (i: number) => {
    const next = focus.map((f, ix) => (ix === i ? { ...f, done: !f.done } : f));
    setFocus(next); persist({ focus: next });
  };
  const removeFocus = (i: number) => {
    const next = focus.filter((_, ix) => ix !== i);
    setFocus(next); persist({ focus: next });
  };

  const doneCount = focus.filter((f) => f.done).length;
  // Due-today tasks not already added as a focus item.
  const suggestions = (data?.dueToday ?? []).filter((t) => !focus.some((f) => f.taskId === t.id));

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader
        title="Daily Plan"
        subtitle={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        right={data ? <StatusPill label={`${data.productivityPct}%`} tone={data.productivityPct >= 60 ? "success" : data.productivityPct > 0 ? "warning" : "neutral"} size="sm" /> : undefined}
      />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {isLoading ? (
          <Card><Skeleton width="60%" height={18} /><Skeleton width="90%" height={44} style={{ marginTop: 12 }} /></Card>
        ) : (
          <>
            <Text variant="title">{greeting()}</Text>
            <Text variant="body" tone="muted" style={{ marginTop: 2 }}>
              {focus.length > 0 ? `${doneCount} of ${focus.length} focus items done` : "Set your focus for today."}
            </Text>

            {/* Today's focus */}
            <SectionLabel icon="target" text="TODAY'S FOCUS" />
            <Card flat style={{ padding: 0, overflow: "hidden" }}>
              {focus.length === 0 ? (
                <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">Nothing yet — add your top 3 priorities below.</Text></View>
              ) : (
                focus.map((f, i) => (
                  <View key={i} style={[styles.focusRow, i < focus.length - 1 && styles.divider]}>
                    <Pressable onPress={() => toggleFocus(i)} hitSlop={8}>
                      <Feather name={f.done ? "check-circle" : "circle"} size={22} color={f.done ? toneColors("success").fg : palette.faint} />
                    </Pressable>
                    <Text variant="body" style={[{ flex: 1 }, f.done && { textDecorationLine: "line-through", color: palette.faint }]}>{f.text}</Text>
                    <Pressable onPress={() => removeFocus(i)} hitSlop={8}><Feather name="x" size={16} color={palette.faint} /></Pressable>
                  </View>
                ))
              )}
              {/* Add row */}
              <View style={[styles.addRow, focus.length > 0 && styles.divider]}>
                <Feather name="plus" size={18} color={palette.brand} />
                <TextInput
                  style={styles.addInput}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a focus item…"
                  placeholderTextColor={palette.faint}
                  returnKeyType="done"
                  onSubmitEditing={() => addFocus(draft)}
                />
                {draft.trim() ? <Pressable onPress={() => addFocus(draft)} hitSlop={8}><Text style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Add</Text></Pressable> : null}
              </View>
            </Card>

            {/* Pull from due-today tasks */}
            {suggestions.length > 0 ? (
              <>
                <Text variant="caption" tone="faint" style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>DUE TODAY — TAP TO ADD</Text>
                <View style={{ gap: spacing.sm }}>
                  {suggestions.slice(0, 6).map((t) => (
                    <Pressable key={t.id} style={styles.sugRow} onPress={() => addFocus(t.title, t.id)}>
                      <Feather name="plus-circle" size={16} color={palette.brand} />
                      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Text>
                      {t.for ? <Text variant="caption" tone="muted" numberOfLines={1}>{t.for}</Text> : null}
                      <StatusPill label={t.priority} tone={PRIORITY_TONE[t.priority] ?? "neutral"} size="sm" dot={false} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {/* Evening reflection */}
            <SectionLabel icon="edit-3" text="REFLECTION" />
            <Card flat>
              <TextField label="One key learning today" value={learning} onChangeText={setLearning} multiline placeholder="What did you learn?" />
              <TextField label="Breakthrough — the win 🎉" value={breakthrough} onChangeText={setBreakthrough} multiline placeholder="Your best moment today" />
              <TextField label="Breakdown — what got stuck" value={breakdown} onChangeText={setBreakdown} multiline placeholder="What to fix tomorrow" />
              <Pressable style={styles.saveBtn} onPress={() => { persist(); toast.success("Daily plan saved"); }}>
                <Feather name="check" size={16} color={palette.white} />
                <Text style={{ color: palette.white, fontWeight: fontWeight.semibold as any }}>Save reflection</Text>
              </Pressable>
            </Card>

            {/* Yesterday context */}
            <SectionLabel icon="rotate-ccw" text="CARRIED OVER" />
            <Card flat style={{ padding: 0, overflow: "hidden" }}>
              {(data?.incompleteCarried ?? []).length === 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg }}>
                  <Feather name="check-circle" size={18} color={toneColors("success").fg} />
                  <Text variant="body" tone="muted">Nothing overdue — you're on top of it.</Text>
                </View>
              ) : (
                (data?.incompleteCarried ?? []).slice(0, 8).map((t, i, arr) => (
                  <View key={t.id} style={[styles.focusRow, i < arr.length - 1 && styles.divider]}>
                    <Feather name="alert-circle" size={16} color={toneColors("warning").fg} />
                    <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{t.title}</Text>
                    <StatusPill label={t.priority} tone={PRIORITY_TONE[t.priority] ?? "neutral"} size="sm" dot={false} />
                  </View>
                ))
              )}
            </Card>
            {(data?.completedYesterday.length ?? 0) > 0 ? (
              <Text variant="caption" tone="faint" style={{ marginTop: spacing.md, textAlign: "center" }}>
                ✓ {data!.completedYesterday.length} task{data!.completedYesterday.length === 1 ? "" : "s"} completed yesterday
              </Text>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}

function SectionLabel({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.sm }}><Feather name={icon} size={13} color={palette.muted} /><Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  focusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  addInput: { flex: 1, fontSize: 15, color: palette.ink, padding: 0 },
  sugRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
});
