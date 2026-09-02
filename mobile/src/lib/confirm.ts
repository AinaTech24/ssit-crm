/**
 * confirmDelete — the ONE way to guard a destructive action. Every delete /
 * remove / purge in the app must route through this so the user always gets a
 * confirmation dialog first (native Alert + a warning haptic on confirm).
 */

import { Alert } from "react-native";
import * as Haptics from "expo-haptics";

export function confirmDelete(
  opts: { title?: string; message?: string; confirmLabel?: string },
  onConfirm: () => void
) {
  Alert.alert(opts.title ?? "Delete?", opts.message ?? "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    {
      text: opts.confirmLabel ?? "Delete",
      style: "destructive",
      onPress: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        onConfirm();
      },
    },
  ]);
}
