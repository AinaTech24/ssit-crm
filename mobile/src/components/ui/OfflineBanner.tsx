/**
 * OfflineBanner — a thin bar under the status bar shown when the API is
 * unreachable (see connectivity store). Auto-hides once a request succeeds.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useConnectivity } from "../../state/connectivity";
import { useOfflineQueue } from "../../lib/offlineQueue";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { Text } from "./Text";

export function OfflineBanner() {
  const online = useConnectivity((s) => s.online);
  const pending = useOfflineQueue((s) => s.items.length);
  const insets = useSafeAreaInsets();
  if (online) return null;
  // Work IS saved now — it queues and replays on reconnect — so say so rather
  // than the old "changes may not save", which is no longer true.
  const label = pending > 0
    ? `Offline — ${pending} change${pending === 1 ? "" : "s"} saved, will sync`
    : "Offline — your work is saved and will sync";
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={[styles.bar, { paddingTop: insets.top + 6 }]} pointerEvents="none">
      <Feather name="wifi-off" size={13} color={palette.white} />
      <Text style={{ color: palette.white, fontWeight: fontWeight.medium as any, fontSize: 12 }}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingBottom: 6, backgroundColor: palette.danger },
});
