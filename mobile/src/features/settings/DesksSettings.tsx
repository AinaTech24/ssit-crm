/**
 * Desks (sub-branch teams) — parity with web /dashboard/settings/desks. Create
 * desks and assign each team member to one, driving the monthly MIS roll-ups.
 * GET /api/desks (board) · POST /api/desks · DELETE /api/desks/[id] · POST /api/desks/assign.
 */

import React, { useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { StatusPill } from "../../components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../components/states";
import { confirmDelete } from "../../lib/confirm";
import { titleCase } from "../../lib/format";
import { palette, radius, spacing, fontSize, fontWeight } from "../../theme/tokens";
import { useDeskBoard, useCreateDesk, useDeleteDesk, useAssignDesk, type DeskMember } from "./api";

export function DesksSettings() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useDeskBoard();
  const create = useCreateDesk();
  const del = useDeleteDesk();
  const assign = useAssignDesk();

  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<DeskMember | null>(null);

  if (isLoading) return <View style={styles.screen}><ScreenHeader title="Desks" /><LoadingState /></View>;
  if (isError || !data) return <View style={styles.screen}><ScreenHeader title="Desks" /><ErrorState onRetry={refetch} /></View>;

  const { branches, desks, members } = data;
  const deskName = (id: string | null) => desks.find((d) => d.id === id)?.name ?? null;
  const count = (deskId: string) => members.filter((m) => m.deskId === deskId).length;

  const addDesk = () => {
    setErr(null);
    if (name.trim().length < 1) return setErr("Enter a desk name.");
    const branchId = branches[0]?.id;
    if (!branchId) return setErr("No branch found.");
    create.mutate({ branchId, name: name.trim() }, { onSuccess: () => setName(""), onError: (e: any) => setErr(e?.message ?? "Could not create desk.") });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Desks" subtitle="Sub-branch teams" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <TextField label="Add a desk" value={name} onChangeText={setName} placeholder="e.g. DK, RC, Team 1" />
          {err ? <Text variant="caption" style={{ color: palette.danger, marginBottom: spacing.sm }}>{err}</Text> : null}
          <Button label="Create desk" full loading={create.isPending} onPress={addDesk} icon={<Feather name="plus" size={16} color={palette.white} />} />
        </Card>

        <Text style={styles.section}>DESKS</Text>
        {desks.length === 0 ? (
          <Card flat><Text variant="caption" tone="muted">No desks yet. Create one above, then assign members below.</Text></Card>
        ) : (
          <Card flat style={{ padding: 0 }}>
            {desks.map((d, i) => (
              <View key={d.id} style={[styles.row, i < desks.length - 1 && styles.divider]}>
                <View style={styles.iconWrap}><Feather name="share-2" size={15} color={palette.brandDark} /></View>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{d.name}</Text>
                  <Text variant="caption" tone="muted">{count(d.id)} member{count(d.id) === 1 ? "" : "s"}</Text>
                </View>
                <Pressable onPress={() => confirmDelete({ title: "Delete desk?", message: `"${d.name}" — members become unassigned.` }, () => del.mutate(d.id))} hitSlop={8} style={styles.delBtn}>
                  <Feather name="trash-2" size={16} color={palette.danger} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <Text style={styles.section}>TEAM MEMBERS</Text>
        <Card flat style={{ padding: 0 }}>
          {members.map((m, i) => (
            <Pressable key={m.id} style={[styles.row, i < members.length - 1 && styles.divider]} onPress={() => setPicker(m)}>
              <View style={{ flex: 1 }}>
                <Text variant="body">{m.name}</Text>
                <Text variant="caption" tone="muted">{Array.isArray(m.roles) ? m.roles.map(titleCase).join(", ") : "—"}</Text>
              </View>
              <StatusPill label={deskName(m.deskId) ?? "Unassigned"} tone={m.deskId ? "info" : "neutral"} dot={false} size="sm" />
              <Feather name="chevron-right" size={16} color={palette.faint} style={{ marginLeft: spacing.sm }} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>

      {/* Assign-to-desk picker */}
      <BottomSheet visible={!!picker} onClose={() => setPicker(null)} title={picker ? `Assign ${picker.name}` : ""}>
        <View style={{ gap: spacing.xs }}>
          <Pressable style={styles.opt} onPress={() => { if (picker) assign.mutate({ userId: picker.id, deskId: null }); setPicker(null); }}>
            <Text variant="body" style={{ color: picker?.deskId == null ? palette.brandDark : palette.ink }}>Unassigned</Text>
            {picker?.deskId == null ? <Feather name="check" size={18} color={palette.brand} /> : null}
          </Pressable>
          {desks.map((d) => (
            <Pressable key={d.id} style={styles.opt} onPress={() => { if (picker) assign.mutate({ userId: picker.id, deskId: d.id }); setPicker(null); }}>
              <Text variant="body" style={{ color: picker?.deskId === d.id ? palette.brandDark : palette.ink }}>{d.name}</Text>
              {picker?.deskId === d.id ? <Feather name="check" size={18} color={palette.brand} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  section: { fontSize: fontSize.xs, fontWeight: fontWeight.bold as any, letterSpacing: 0.6, color: palette.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  delBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  opt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
});
