/**
 * startCall — arm a pending call-log intent, then open the native dialer. Use
 * this everywhere instead of a raw `Linking.openURL("tel:…")` so the app can
 * prompt to log the call when the user returns (see CallLogPrompt).
 */

import { Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { useCallIntent, type CallIntent } from "../../state/callIntent";

export function startCall(intent: Omit<CallIntent, "armedAt">) {
  const phone = (intent.phone ?? "").trim();
  if (!phone) return;
  useCallIntent.getState().arm({ ...intent, phone });
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  Linking.openURL(`tel:${phone}`).catch(() => {});
}
