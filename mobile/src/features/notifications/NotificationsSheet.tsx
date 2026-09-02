/**
 * NotificationsSheet — the bell opens THIS (a bottom sheet that slides up over
 * the current screen), not a full navigation. Shows the most recent items;
 * "View all" hands off to the full /notifications screen for history. Mirrors
 * HeaderProfileButton's sheet pattern so the two header buttons feel the same.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { toMobileRoute } from "../command-center/api";
import { timeAgo } from "../../lib/format";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";
import { useNotifications, useMarkRead, isUnread, type AppNotification } from "./api";

const SHOWN = 6;

export function NotificationsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data } = useNotifications();
  const markRead = useMarkRead();

  const rows = (data?.notifications ?? []).slice(0, SHOWN);
  const unread = (data?.notifications ?? []).filter(isUnread);

  const open = (n: AppNotification) => {
    if (isUnread(n) && n.id) markRead.mutate({ ids: [n.id] });
    const route = n.linkUrl ? toMobileRoute(n.linkUrl) : null;
    onClose();
    if (route) router.push(route as any);
  };

  const viewAll = () => {
    onClose();
    router.push("/notifications" as any);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Notifications">
      {unread.length > 0 ? (
        <Pressable onPress={() => markRead.mutate({ all: true })} hitSlop={8} style={styles.markAll}>
          <Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>Mark all read</Text>
        </Pressable>
      ) : null}

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="bell" size={20} color={palette.faint} />
          <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>Nothing to catch up on.</Text>
        </View>
      ) : (
        rows.map((n, i) => (
          <Pressable key={n.id ?? i} style={[styles.row, i < rows.length - 1 && styles.divider]} onPress={() => open(n)}>
            <View style={[styles.dot, { backgroundColor: isUnread(n) ? palette.brand : "transparent" }]} />
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={2} style={{ fontWeight: (isUnread(n) ? fontWeight.semibold : fontWeight.regular) as any }}>{n.title ?? "Notification"}</Text>
              {n.body ? <Text variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>{n.body}</Text> : null}
              <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{timeAgo(n.createdAt)}</Text>
            </View>
          </Pressable>
        ))
      )}

      <Pressable onPress={viewAll} style={styles.viewAll}>
        <Text variant="body" style={{ color: palette.brand, fontWeight: fontWeight.semibold as any }}>View all notifications</Text>
        <Feather name="chevron-right" size={16} color={palette.brand} />
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  markAll: { alignSelf: "flex-end", marginBottom: spacing.sm },
  empty: { alignItems: "center", paddingVertical: spacing.xl },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  viewAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
});
