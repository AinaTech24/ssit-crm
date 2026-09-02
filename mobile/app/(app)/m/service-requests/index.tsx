/**
 * Service Requests — the client-servicing queue. SLA breaches float to the top
 * with a red rail, because those are the ones a client is already unhappy about.
 * Filter chips: Breached / Open / Resolved / All.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Chip } from "../../../../src/components/ui/Chip";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import {
  useServiceRequests, srStatusMeta, isSrOpen, isSlaBreached, PRIORITY_TONE, type ServiceRequest,
} from "../../../../src/features/service-requests/api";
import { fmtDate, timeAgo, titleCase } from "../../../../src/lib/format";
import { spacing, palette, fontWeight } from "../../../../src/theme/tokens";
import { toneColors } from "../../../../src/theme";

type Bucket = "breached" | "open" | "resolved" | "all";
const TABS: { key: Bucket; label: string }[] = [
  { key: "breached", label: "SLA breached" },
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export default function ServiceRequestsList() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useServiceRequests();
  const [tab, setTab] = React.useState<Bucket>("breached");

  const all = data ?? [];
  const buckets: Record<Bucket, ServiceRequest[]> = {
    all,
    breached: all.filter(isSlaBreached),
    open: all.filter((r) => isSrOpen(r) && !isSlaBreached(r)),
    resolved: all.filter((r) => !isSrOpen(r)),
  };
  const rows = buckets[tab];

  const header = (
    <View style={{ paddingBottom: spacing.sm }}>
      <Card style={{ marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: buckets.breached.length ? toneColors("danger").fg : palette.line }}>
        <Text variant="caption" tone="faint">SLA BREACHED</Text>
        <Text style={styles.hero}>{buckets.breached.length || "None"}</Text>
        <Text variant="caption" tone="muted">
          {buckets.open.length} open · {buckets.resolved.length} resolved
        </Text>
      </Card>
      <View style={styles.chips}>
        {TABS.map((t) => (
          <Chip key={t.key} label={`${t.label} (${buckets[t.key].length})`} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Service Requests" subtitle={`${all.length} tickets`} />
      {isLoading ? (
        <View style={{ padding: spacing.lg }}>{header}<Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} /><Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} /></View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: spacing["2xl"], gap: spacing.md }}>
              <Feather name={tab === "breached" ? "check-circle" : "life-buoy"} size={22} color={palette.faint} />
              <Text variant="body" tone="muted">{tab === "breached" ? "Nothing past its SLA — good." : "Nothing here."}</Text>
            </View>
          }
          renderItem={({ item }) => <SrRow r={item} onPress={() => router.push(`/m/service-requests/${item.id}` as any)} />}
        />
      )}
    </View>
  );
}

function SrRow({ r, onPress }: { r: ServiceRequest; onPress: () => void }) {
  const meta = srStatusMeta(r.status);
  const breached = isSlaBreached(r);
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: spacing.sm, ...(breached ? { borderLeftWidth: 3, borderLeftColor: toneColors("danger").fg } : null) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold as any }} numberOfLines={1}>{r.subject ?? "Request"}</Text>
          <StatusPill label={meta.label} tone={meta.tone} size="sm" />
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {[r.ticketNo, r.type ? titleCase(r.type.replace(/_/g, " ")) : null].filter(Boolean).join(" · ")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          {breached ? <StatusPill label="SLA passed" tone="danger" size="sm" dot={false} /> : null}
          {r.priority ? <StatusPill label={titleCase(r.priority)} tone={PRIORITY_TONE[r.priority] ?? "neutral"} size="sm" dot={false} /> : null}
          <View style={{ flex: 1 }} />
          <Text variant="caption" tone="faint">{timeAgo(r.createdAt)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { fontSize: 26, fontWeight: fontWeight.bold as any, letterSpacing: -0.4, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
