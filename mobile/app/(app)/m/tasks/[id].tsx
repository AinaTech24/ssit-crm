/**
 * Task detail — web parity. Title + status/priority (tap to change), snooze
 * (+1d/+1w/+1m), sub-tasks checklist (add/cycle/remove, auto-saved), remarks log
 * (append + history), all fields, related client/lead/meeting links, edit + delete.
 * From GET /api/tasks/[id]; mutations via PATCH /api/tasks/[id].
 */

import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { TextField } from "../../../../src/components/ui/TextField";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { confirmDelete } from "../../../../src/lib/confirm";
import { useTask, useUpdateTask, useDeleteTask, TASK_PRIORITY_TONE, TASK_STATUSES, TASK_PRIORITIES, slaInfo, checklistProgress, type ChecklistItem } from "../../../../src/features/tasks/api";
import { titleCase, fmtDate, timeAgo } from "../../../../src/lib/format";
import { taskStatusBadge } from "../../../../src/lib/status";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

const CHECK_CYCLE: Record<string, ChecklistItem["status"]> = { not_started: "in_progress", in_progress: "completed", completed: "not_started", assigned_to_other: "not_started" };
const CHECK_ICON: Record<string, string> = { not_started: "circle", in_progress: "loader", completed: "check-circle", assigned_to_other: "user" };
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const update = useUpdateTask(id!);
  const del = useDeleteTask();
  const [statusSheet, setStatusSheet] = useState(false);
  const [prioSheet, setPrioSheet] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Task" /><LoadingState /></View>;
  if (isError || !task) return <View style={styles.screen}><ScreenHeader title="Task" /><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></View>;

  const status = taskStatusBadge(task.status);
  const done = task.status === "completed";
  const sla = slaInfo(task);
  const checklist: ChecklistItem[] = task.meta?.checklist ?? [];
  const cl = checklistProgress(task);
  const remarks = parseRemarks(task.remarks);

  const patch = (p: any) => { Haptics.selectionAsync().catch(() => {}); update.mutate(p); };
  const setStatus = (s: string) => { setStatusSheet(false); patch({ status: s }); };
  const setPriority = (p: string) => { setPrioSheet(false); patch({ priority: p }); };
  const snooze = (days: number) => {
    const base = task.dueAt ? new Date(task.dueAt) : new Date();
    base.setDate(base.getDate() + days);
    patch({ dueAt: base.toISOString() });
  };
  const saveChecklist = (items: ChecklistItem[]) => update.mutate({ checklist: items });
  const cycleItem = (item: ChecklistItem) => saveChecklist(checklist.map((c) => c.id === item.id ? { ...c, status: CHECK_CYCLE[c.status ?? "not_started"], done: CHECK_CYCLE[c.status ?? "not_started"] === "completed" } : c));
  const removeItem = (item: ChecklistItem) => saveChecklist(checklist.filter((c) => c.id !== item.id));
  const addItem = () => { if (!newItem.trim()) return; saveChecklist([...checklist, { id: newId(), text: newItem.trim(), status: "not_started", done: false }]); setNewItem(""); };
  const addComment = () => { if (!comment.trim()) return; update.mutate({ remarks: comment.trim() } as any, { onSuccess: () => setComment("") }); };
  const onDelete = () => confirmDelete({ title: "Delete task?", message: "It moves to Trash — you can restore it later." }, () => del.mutate(id!, { onSuccess: () => router.back() }));

  const related = [
    task.relatedInvestorId && { href: `/m/investors/${task.relatedInvestorId}`, icon: "user", label: task.investorName ? `Client · ${task.investorName}` : "Related client" },
    task.relatedLeadId && { href: `/m/leads/${task.relatedLeadId}`, icon: "trending-up", label: task.leadName ? `Lead · ${task.leadName}` : "Related lead" },
    task.relatedMeetingId && { href: `/m/review-meetings/${task.relatedMeetingId}`, icon: "calendar", label: "Related meeting" },
  ].filter(Boolean) as { href: string; icon: string; label: string }[];

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Task" subtitle={titleCase(task.type) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeIn.duration(240)}>
          <Card>
            <Text variant="title">{task.title}</Text>
            <View style={styles.badgeRow}>
              <Pressable onPress={() => setStatusSheet(true)}><StatusPill label={status.label} tone={status.tone} /></Pressable>
              <Pressable onPress={() => setPrioSheet(true)}>{task.priority ? <StatusPill label={titleCase(task.priority)} tone={TASK_PRIORITY_TONE[task.priority] ?? "neutral"} dot={false} /> : <StatusPill label="Set priority" tone="neutral" dot={false} />}</Pressable>
              {sla ? <StatusPill label={sla.label} tone={sla.tone} dot={false} /> : null}
            </View>
          </Card>

          {!done ? <Button label="Mark complete" icon={<Feather name="check" size={16} color={palette.white} />} onPress={() => setStatus("completed")} loading={update.isPending} full style={{ marginTop: spacing.lg }} /> : null}

          {/* Snooze */}
          {!done && (
            <View style={styles.snoozeRow}>
              <Text variant="caption" tone="muted" style={{ marginRight: spacing.xs }}>Snooze:</Text>
              <SnoozeBtn label="+1d" onPress={() => snooze(1)} />
              <SnoozeBtn label="+1w" onPress={() => snooze(7)} />
              <SnoozeBtn label="+1m" onPress={() => snooze(30)} />
            </View>
          )}

          <View style={{ marginTop: spacing.md, flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}><Button label="Edit" variant="secondary" full icon={<Feather name="edit-2" size={16} color={palette.ink} />} onPress={() => router.push(`/m/tasks/new?editId=${id}` as any)} /></View>
            <View style={{ flex: 1 }}><Button label="Delete" variant="danger" full loading={del.isPending} icon={<Feather name="trash-2" size={16} color={palette.white} />} onPress={onDelete} /></View>
          </View>

          {/* Fields */}
          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Type" value={titleCase(task.type)} />
            <Field label="Priority" value={titleCase(task.priority)} />
            <Field label="Department" value={titleCase(task.department)} />
            <Field label="Assignee" value={task.assignee} />
            <Field label="Due" value={fmtDate(task.dueAt)} />
            <Field label="SLA due" value={fmtDate(task.slaDueAt)} />
            <Field label="Completed" value={fmtDate(task.completedAt)} last />
          </Card>

          {task.description ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">DESCRIPTION</Text>
              <Text variant="body" style={{ marginTop: 4 }}>{task.description}</Text>
            </Card>
          ) : null}

          {/* Checklist */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.secHead}>
              <Feather name="check-square" size={14} color={palette.muted} />
              <Text variant="label" tone="muted" style={{ flex: 1 }}>SUB-TASKS</Text>
              {cl.total > 0 ? <Text variant="caption" tone="muted">{cl.done}/{cl.total} done</Text> : null}
            </View>
            {checklist.length === 0 ? <Text variant="caption" tone="muted">No sub-tasks yet.</Text> : checklist.map((item) => (
              <View key={item.id} style={styles.clRow}>
                <Pressable onPress={() => cycleItem(item)} hitSlop={8}><Feather name={(CHECK_ICON[item.status ?? "not_started"] ?? "circle") as any} size={18} color={item.status === "completed" ? palette.success : palette.faint} /></Pressable>
                <Text variant="body" style={[{ flex: 1 }, item.status === "completed" && { textDecorationLine: "line-through", color: palette.faint }]}>{item.text}</Text>
                <Pressable onPress={() => removeItem(item)} hitSlop={8}><Feather name="x" size={15} color={palette.faint} /></Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}><TextField label="" value={newItem} onChangeText={setNewItem} placeholder="Add a sub-task…" /></View>
              <Button label="Add" size="sm" variant="secondary" onPress={addItem} />
            </View>
          </Card>

          {/* Related */}
          {related.map((r) => (
            <Pressable key={r.href} onPress={() => router.push(r.href as any)} style={{ marginTop: spacing.md }}>
              <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Feather name={r.icon as any} size={18} color={palette.brandDark} />
                <Text variant="body" style={{ flex: 1, color: palette.ink }}>{r.label}</Text>
                <Feather name="chevron-right" size={16} color={palette.faint} />
              </Card>
            </Pressable>
          ))}

          {/* Remarks / comments */}
          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.secHead}><Feather name="message-square" size={14} color={palette.muted} /><Text variant="label" tone="muted" style={{ flex: 1 }}>WORK LOG</Text></View>
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}><TextField label="" value={comment} onChangeText={setComment} placeholder="Add a comment / work log…" multiline /></View>
              <Button label="Log" size="sm" onPress={addComment} loading={update.isPending} />
            </View>
            {remarks.map((r, i) => (
              <View key={i} style={styles.logRow}>
                {r.header ? <Text variant="caption" tone="faint">{r.header}</Text> : null}
                <Text variant="caption">{r.body}</Text>
              </View>
            ))}
          </Card>
        </Animated.View>
      </ScrollView>

      <BottomSheet visible={statusSheet} onClose={() => setStatusSheet(false)} title="Set status">
        {TASK_STATUSES.map((s) => (
          <Pressable key={s.key} onPress={() => setStatus(s.key)} style={styles.option}>
            <Text variant="body" style={{ color: task.status === s.key ? palette.brand : palette.ink }}>{s.label}</Text>
            {task.status === s.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
      <BottomSheet visible={prioSheet} onClose={() => setPrioSheet(false)} title="Set priority">
        {TASK_PRIORITIES.map((p) => (
          <Pressable key={p.key} onPress={() => setPriority(p.key)} style={styles.option}>
            <Text variant="body" style={{ color: task.priority === p.key ? palette.brand : palette.ink }}>{p.label}</Text>
            {task.priority === p.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

function parseRemarks(raw?: string | null): { header: string; body: string }[] {
  if (!raw) return [];
  return raw.split(/\n\n+/).map((block) => {
    const m = block.match(/^\s*\[(.+?)\]\s*([\s\S]*)$/);
    return m ? { header: m[1], body: m[2].trim() } : { header: "", body: block.trim() };
  }).filter((e) => e.body || e.header);
}

function SnoozeBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.snooze}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>{label}</Text></Pressable>;
}
function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.divider]}>
      <Text variant="label" tone="muted">{label}</Text>
      <Text variant="body" style={{ color: palette.ink, flex: 1, textAlign: "right" }} numberOfLines={2}>{value || "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  snoozeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  snooze: { backgroundColor: palette.brandLight, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  secHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  clRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  logRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft, gap: 2, marginTop: spacing.xs },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
});
