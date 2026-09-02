/**
 * Notification inbox — what the firm's engine has been trying to tell this RM
 * (birthdays today, SLA breaches, workflow alerts). Unread first with a dot;
 * tapping opens the linked record and marks it read.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../src/components/ui/Screen";
import { Card } from "../../src/components/ui/Card";
import { Text } from "../../src/components/ui/Text";
import { Skeleton } from "../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../src/components/ui/ScreenHeader";
import { useNotifications, useMarkRead, isUnread, type AppNotification } from "../../src/features/notifications/api";
import { toMobileRoute } from "../../src/features/command-center/api";
import { timeAgo } from "../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../src/theme/tokens";
import { toneColors } from "../../src/theme";

export default function Notifications() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useNotifications();
  const markRead = useMarkRead();

  const rows = data?.notifications ?? [];
  const unread = rows.filter(isUnread);

  const open = (n: AppNotification) => {
    if (isUnread(n) && n.id) markRead.mutate({ ids: [n.id] });
    // Server hrefs are web paths; only follow ones this app can actually render.
    const route = n.linkUrl ? toMobileRoute(n.linkUrl) : null;
    if (route) router.push(route as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader
        title="Notifications"
        subtitle={unread.length ? `${unread.length} unread` : "All caught up"}
        right={
          unread.length > 0 ? (
            <Pressable onPress={() => markRead.mutate({ all: true })} hitSlop={8}>
              <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Mark all read</Text>
            </Pressable>
          ) : undefined
        }
      />
      <Screen scroll padded onRefresh={refetch} refreshing={isRefetching} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {isLoading ? (
          <><Skeleton width="100%" height={64} /><Skeleton width="100%" height={64} style={{ marginTop: spacing.sm }} /></>
        ) : rows.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: spacing["2xl"], gap: spacing.md }}>
            <View style={styles.emptyIcon}><Feather name="bell" size={20} color={palette.faint} /></View>
            <Text variant="body" tone="muted">Nothing to catch up on.</Text>
          </View>
        ) : (
          <Card flat style={{ padding: 0, overflow: "hidden" }}>
            {rows.map((n, i) => (
              <Pressable key={n.id ?? i} style={[styles.row, i < rows.length - 1 && styles.divider, isUnread(n) && styles.unreadRow]} onPress={() => open(n)}>
                <View style={[styles.dot, { backgroundColor: isUnread(n) ? palette.brand : "transparent" }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" numberOfLines={2} style={{ fontWeight: (isUnread(n) ? fontWeight.semibold : fontWeight.regular) as any }}>{n.title ?? "Notification"}</Text>
                  {n.body ? <Text variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>{n.body}</Text> : null}
                  <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{timeAgo(n.createdAt)}</Text>
                </View>
                {n.linkUrl && toMobileRoute(n.linkUrl) ? <Feather name="chevron-right" size={16} color={palette.faint} /> : null}
              </Pressable>
            ))}
          </Card>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  unreadRow: { backgroundColor: palette.brandLight },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
});
