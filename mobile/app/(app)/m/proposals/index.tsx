/**
 * Proposals list — the RM's outgoing investment proposals. Status filter chips +
 * a count ribbon; tap a row to open, FAB to create. Newest first.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { FAB } from "../../../../src/components/ui/FAB";
import { useProposals, num, type Proposal, type ProposalStatus } from "../../../../src/features/proposals/api";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const STATUS_TONE: Record<ProposalStatus, Tone> = {
  draft: "neutral", ready: "info", sent: "info", viewed: "brand", accepted: "success", rejected: "danger", expired: "warning",
};
const FILTERS: { key: string; label: string; match: (s: ProposalStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "draft", label: "Drafts", match: (s) => s === "draft" || s === "ready" },
  { key: "sent", label: "Awaiting", match: (s) => s === "sent" || s === "viewed" },
  { key: "accepted", label: "Accepted", match: (s) => s === "accepted" },
];

export default function ProposalsList() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useProposals();
  const [filter, setFilter] = React.useState("all");

  const all = data ?? [];
  const active = FILTERS.find((f) => f.key === filter)!;
  const rows = all.filter((p) => active.match(p.status));

  const header = (
    <View>
      <View style={styles.ribbon}>
        <Metric label="Total" value={String(all.length)} />
        <View style={styles.vline} />
        <Metric label="Awaiting" value={String(all.filter((p) => p.status === "sent" || p.status === "viewed").length)} />
        <View style={styles.vline} />
        <Metric label="Accepted" value={String(all.filter((p) => p.status === "accepted").length)} />
      </View>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]}>
            <Text variant="caption" style={{ color: filter === f.key ? palette.white : palette.muted, fontWeight: fontWeight.semibold as any }}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Proposals" subtitle={`${all.length} total`} />
      {isLoading ? (
        <View style={{ padding: spacing.lg }}>{header}<Skeleton width="100%" height={72} style={{ marginTop: spacing.md }} /><Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} /></View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={<Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>No proposals here yet.</Text>}
          renderItem={({ item }) => <Row p={item} onPress={() => router.push(`/m/proposals/${item.id}` as any)} />}
        />
      )}
      <FAB icon="plus" onPress={() => router.push("/m/proposals/new" as any)} />
    </View>
  );
}

function Row({ p, onPress }: { p: Proposal; onPress: () => void }) {
  const invest = num(p.totalInvestment);
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold as any }} numberOfLines={1}>{p.title}</Text>
          <StatusPill label={titleCase(p.status)} tone={STATUS_TONE[p.status]} size="sm" />
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {p.proposalNumber} · {p.recipientName}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm }}>
          <Text variant="caption" tone="faint">{titleCase(p.type.replace(/_/g, " "))}</Text>
          {invest > 0 ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold as any, color: palette.ink }}>{inr(invest)}</Text> : null}
          <Text variant="caption" tone="faint">{fmtDate(p.createdAt)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 18, fontWeight: fontWeight.bold as any }}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}

const styles = StyleSheet.create({
  ribbon: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  vline: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: palette.line },
  chips: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
});
