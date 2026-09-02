/**
 * Authenticated shell. A native STACK is the parent navigator: its base screen
 * is the drawer+tabs group, and every module screen (/m/*, search,
 * notifications) PUSHES on top with the platform transition + iOS swipe-back —
 * the drawer never swallows push animations (it used to own every screen, which
 * made all navigation snap with no motion). Guards against a lost session.
 */

import React from "react";
import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/state/session";
import { useApplyTenantBrand } from "../../src/features/settings/api";
import { CallLogPrompt } from "../../src/features/activities/CallLogPrompt";
import { OfflineBanner } from "../../src/components/ui/OfflineBanner";
import { useRecentlyViewed } from "../../src/state/recentlyViewed";
import { configurePushHandler, registerForPush } from "../../src/lib/push";
import { useOfflineQueue, watchConnectivityAndFlush } from "../../src/lib/offlineQueue";
import { usePrefs } from "../../src/state/prefs";
import { palette } from "../../src/theme/tokens";

// Deep links into /m/* land with the drawer+tabs group as the back anchor, so
// the first back press goes Home instead of exiting the app.
export const unstable_settings = { initialRouteName: "(drawer)" };

export default function AppLayout() {
  const status = useSession((s) => s.status);
  const token = useSession((s) => s.token);
  // Apply the firm's brand colour app-wide (and live whenever the theme is saved).
  useApplyTenantBrand();
  // Restore the recently-viewed rail once per authenticated session.
  const hydrate = useRecentlyViewed((s) => s.hydrate);
  React.useEffect(() => {
    if (status === "authed") hydrate();
  }, [status, hydrate]);
  // Register for push notifications (best-effort; no-ops until a dev build exists).
  React.useEffect(() => {
    configurePushHandler();
    if (status === "authed" && token) registerForPush(token);
  }, [status, token]);
  // Restore any writes made while offline and replay them the moment we're back.
  React.useEffect(() => {
    if (status !== "authed") return;
    useOfflineQueue.getState().hydrate().then(() => useOfflineQueue.getState().flush());
    return watchConnectivityAndFlush();
  }, [status]);
  // Device preferences (e.g. auto-log calls) must be loaded before the first
  // call returns, or the very first call would use the default instead.
  React.useEffect(() => { usePrefs.getState().hydrate(); }, []);
  if (status !== "authed") return <Redirect href="/login" />;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.surfaceAlt },
        }}
      >
        <Stack.Screen name="(drawer)" />
      </Stack>
      {/* Semi-automatic call logging — prompts to log a call on return to the app. */}
      <CallLogPrompt />
      <OfflineBanner />
    </>
  );
}
