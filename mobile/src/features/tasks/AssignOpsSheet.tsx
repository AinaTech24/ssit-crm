/**
 * Assign-to-ops sheet — hand work to the back office from wherever the RM
 * already is (a client, a lead, a bouncing SIP, a service request), with the
 * context pre-filled. Task delegation existed before this, but only from a
 * blank form: standing in front of a client, retyping who it's about is the
 * reason it never got done.
 *
 * Defaults to the Operations department, high priority, due tomorrow — the
 * common case — and still lets the RM pick a specific person.
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { TextField } from "../../components/ui/TextField";
import { Segmented } from "../../components/ui/Segmented";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { api } from "../../api/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";

const DEPARTMENTS = [
  { key: "operations", label: "Operations" },
  { key: "compliance", label: "Compliance" },
  { key: "support", label: "Support" },
  { key: "advisory", label: "Advisory" },
];
const PRIORITIES = [
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
  { key: "urgent", label: "Urgent" },
];

/** Common back-office asks — one tap instead of typing the same thing daily. */
const PRESETS = [
  "Process KYC documents",
  "Update bank mandate",
  "Fix bounced SIP mandate",
  "Chase pending documents",
  "Process redemption request",
];

interface Employee { id: string; name: string }

function useEmployees() {
  return useQuery({
    queryKey: ["employees-lite"],
    queryFn: () => api.get<any>("/api/employees").then((r) => (Array.isArray(r) ? r : r?.employees ?? r?.rows ?? [])),
    staleTime: 5 * 60_000,
  });
}

export function AssignOpsSheet({
  visible, onClose, subjectType, subjectId, subjectName, defaultTitle,
}: {
  visible: boolean;
  onClose: () => void;
  /** What the task is about — drives the related-record link. */
  subjectType: "investor" | "lead";
  subjectId: string;
  subjectName?: string | null;
  /** Pre-filled title, e.g. "Fix bounced SIP — NACH mandate expired". */
  defaultTitle?: string;
}) {
  const qc = useQueryClient();
  const { data: employees } = useEmployees();
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [department, setDepartment] = React.useState("operations");
  const [priority, setPriority] = React.useState("high");
  const [assignee, setAssignee] = React.useState<Employee | null>(null);

  React.useEffect(() => {
    if (visible) {
      setTitle(defaultTitle ?? "");
      setNote(""); setDepartment("operations"); setPriority("high"); setAssignee(null);
    }
  }, [visible, defaultTitle]);

  const create = useMutation({
    mutationFn: (body: Record<string, any>) => api.post<{ id: string }>("/api/tasks", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["my-day"] });
      toast.success(`Sent to ${DEPARTMENTS.find((d) => d.key === department)?.label ?? "the team"}`);
      onClose();
    },
    onError: (e: any) => toast.error(e?.body?.error || "Couldn't create the task"),
  });

  const submit = () => {
    const t = title.trim();
    if (t.length < 2) return toast.error("Give the task a title");
    const due = new Date();
    due.setDate(due.getDate() + 1); // tomorrow — the back office works next-day
    create.mutate({
      title: t,
      description: note.trim() || undefined,
      type: "follow_up",
      department,
      priority,
      status: "open",
      subjectType,
      subjectId,
      ...(subjectType === "investor" ? { relatedInvestorId: subjectId } : { relatedLeadId: subjectId }),
      ...(assignee ? { assigneeId: assignee.id } : {}),
      dueAt: due.toISOString(),
    });
  };

  const list: Employee[] = Array.isArray(employees) ? employees : [];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Assign to team">
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
        {subjectName ? (
          <View style={styles.aboutRow}>
            <Feather name="user" size={13} color={palette.muted} />
            <Text variant="caption" tone="muted">About {subjectName}</Text>
          </View>
        ) : null}

        {/* Presets — the same handful of asks, every day */}
        {!title ? (
          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <Pressable key={p} style={styles.preset} onPress={() => setTitle(p)}>
                <Text variant="caption" style={{ color: palette.brand }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <TextField label="What needs doing" value={title} onChangeText={setTitle} required placeholder="e.g. Process KYC documents" />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Team</Text>
        <Segmented options={DEPARTMENTS} value={department} onChange={setDepartment} />
        <View style={{ height: spacing.lg }} />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Priority</Text>
        <Segmented options={PRIORITIES} value={priority} onChange={setPriority} />
        <View style={{ height: spacing.lg }} />

        {list.length > 0 ? (
          <>
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
              Assign to someone (optional)
            </Text>
            <View style={styles.people}>
              {list.slice(0, 8).map((e) => {
                const on = assignee?.id === e.id;
                return (
                  <Pressable key={e.id} style={[styles.person, on && styles.personOn]} onPress={() => setAssignee(on ? null : e)}>
                    <Text variant="caption" style={{ color: on ? palette.white : palette.ink }}>{e.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ height: spacing.lg }} />
          </>
        ) : null}

        <TextField label="Note for the team (optional)" value={note} onChangeText={setNote} multiline placeholder="Anything they need to know…" />
      </ScrollView>

      <Pressable style={[styles.btn, create.isPending && { opacity: 0.6 }]} onPress={submit} disabled={create.isPending}>
        <Feather name="send" size={16} color={palette.white} />
        <Text style={styles.btnTxt}>{create.isPending ? "Sending…" : "Send to team"}</Text>
      </Pressable>
      <Text variant="caption" tone="faint" style={{ textAlign: "center", marginTop: spacing.sm }}>Due tomorrow · they'll see it in their queue</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  aboutRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.md },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  preset: { borderWidth: 1, borderColor: palette.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  people: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  person: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  personOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  btnTxt: { color: palette.white, fontWeight: fontWeight.semibold as any },
});
