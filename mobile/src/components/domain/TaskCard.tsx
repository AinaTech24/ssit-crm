/**
 * TaskCard — one task. Priority rail + type icon, title, subject (client/lead) ·
 * type · department, status / priority / SLA / checklist badges, and due + assignee.
 * `compact` mode is used in the kanban columns.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { titleCase, fmtDate } from "../../lib/format";
import { taskStatusBadge } from "../../lib/status";
import { TASK_PRIORITY_TONE, slaInfo, checklistProgress, type Task } from "../../features/tasks/api";
import { toneColors } from "../../theme";

const TYPE_ICON: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  follow_up: "corner-up-right", review_meeting: "calendar", collect_document: "file",
  kyc_renewal: "shield", mandate_renewal: "refresh-cw", custom: "check-square",
  call: "phone", email: "mail", meeting: "calendar", proposal: "file-text", document: "file", other: "check-square",
};

function subjectLine(task: Task): string {
  const subj = task.investorName ?? task.leadName;
  return [subj, task.type ? titleCase(task.type) : null, task.department ? titleCase(task.department) : null].filter(Boolean).join(" · ");
}

export function TaskCard({ task, onPress, compact }: { task: Task; onPress: () => void; compact?: boolean }) {
  const status = taskStatusBadge(task.status);
  const priTone = TASK_PRIORITY_TONE[task.priority ?? ""] ?? "neutral";
  const rail = toneColors(priTone).fg;
  const overdue = ["open", "in_progress", "blocked"].includes(task.status ?? "") && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  const done = task.status === "completed";
  const sla = slaInfo(task);
  const cl = checklistProgress(task);

  if (compact) {
    return (
      <Card onPress={onPress} style={styles.compact} padded={false}>
        <View style={[styles.rail, { backgroundColor: rail }]} />
        <Text variant="label" numberOfLines={2} style={done ? { textDecorationLine: "line-through", color: palette.faint } : undefined}>{task.title ?? "Task"}</Text>
        {subjectLine(task) ? <Text variant="caption" tone="muted" numberOfLines={1}>{subjectLine(task)}</Text> : null}
        <View style={styles.badges}>
          {task.priority ? <StatusPill label={titleCase(task.priority)} tone={priTone} size="sm" dot={false} /> : null}
          {sla ? <StatusPill label={sla.label} tone={sla.tone} size="sm" dot={false} /> : null}
          {task.dueAt ? <Text variant="caption" tone={overdue ? "danger" : "faint"}>{fmtDate(task.dueAt)}</Text> : null}
        </View>
      </Card>
    );
  }

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md, overflow: "hidden" }}>
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingLeft: spacing.sm }}>
        <View style={styles.icon}>
          <Feather name={done ? "check" : TYPE_ICON[task.type ?? "other"] ?? "check-square"} size={18} color={done ? palette.success : palette.muted} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={2} style={done ? { textDecorationLine: "line-through", color: palette.faint } : undefined}>{task.title ?? "Task"}</Text>
          {subjectLine(task) ? <Text variant="caption" tone="muted" numberOfLines={1}>{subjectLine(task)}</Text> : null}
          <View style={styles.badges}>
            <StatusPill label={status.label} tone={status.tone} size="sm" />
            {task.priority ? <StatusPill label={titleCase(task.priority)} tone={priTone} size="sm" dot={false} /> : null}
            {sla ? <StatusPill label={sla.label} tone={sla.tone} size="sm" dot={false} /> : null}
            {cl.total > 0 ? <Text variant="caption" tone="faint">✓ {cl.done}/{cl.total}</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {task.dueAt ? (<><Text variant="caption" tone="faint">Due</Text><Text variant="label" tone={overdue ? "danger" : "muted"}>{fmtDate(task.dueAt)}</Text></>) : null}
          {task.assignee ? <Text variant="caption" tone="faint" numberOfLines={1}>{task.assignee}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  icon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2, alignItems: "center" },
  compact: { marginBottom: spacing.sm, padding: spacing.md, paddingLeft: spacing.md, gap: 4, width: 210, overflow: "hidden" },
});
