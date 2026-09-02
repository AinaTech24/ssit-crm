/**
 * Push notifications (Expo, SDK 56).
 *
 * CRITICAL — why everything here lazy-`require`s expo-notifications:
 * In Expo Go (SDK 53+), the expo-notifications module THROWS during its own
 * initialization because remote push was removed from Expo Go. A static
 * `import * as Notifications from "expo-notifications"` runs that init at app
 * startup and red-screens the whole app before any of our guard code executes.
 * So we never import it at module scope — we `require()` it lazily, and only
 * after confirming we're NOT in Expo Go. In Expo Go the module is therefore
 * never loaded and never throws; push simply stays off.
 *
 * Remote push needs a development/production build anyway (Expo Go can't deliver
 * it), so being a no-op in Expo Go loses nothing.
 */

import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";

/** True inside the Expo Go sandbox (no remote push). */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants as any).appOwnership === "expo";

/**
 * Lazily load expo-notifications — but NEVER in Expo Go (its init throws there).
 * Returns the module, or null when push isn't available.
 */
function getNotifications(): any | null {
  if (isExpoGo || Platform.OS === "web") return null;
  try {
    // require (not import) so the module body runs only when called, off the
    // Expo Go path — deferring the init that would otherwise crash at startup.
    return require("expo-notifications");
  } catch {
    return null;
  }
}

/** Foreground behaviour — show the banner + list, no sound by default. */
export function setPushHandler() {
  const N = getNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // ignore — push just stays off
  }
}

function resolveProjectId(): string | undefined {
  return (
    (Constants?.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId
  );
}

/**
 * Returns this device's Expo push token, or null if push can't be set up
 * (Expo Go, simulator, permission denied, or no EAS projectId yet). Never throws.
 */
export async function registerForPush(): Promise<string | null> {
  const N = getNotifications();
  if (!N) return null; // Expo Go or module unavailable
  if (!Device.isDevice) return null;

  try {
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("default", {
        name: "Default",
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#2563EB",
      });
    }

    const existing = await N.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await N.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    const projectId = resolveProjectId();
    if (!projectId) return null; // run `eas init` to enable push

    const token = await N.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    return null;
  }
}

/**
 * Subscribe to notification taps → deep-link URL. No-op (inert subscription) in
 * Expo Go. Caller invokes `.remove()` on cleanup.
 */
export function addNotificationTapListener(onUrl: (url: string) => void): { remove: () => void } {
  const N = getNotifications();
  if (!N) return { remove: () => {} };
  try {
    return N.addNotificationResponseReceivedListener((response: any) => {
      const url = response?.notification?.request?.content?.data?.url;
      if (typeof url === "string" && url) onUrl(url);
    });
  } catch {
    return { remove: () => {} };
  }
}

/** Deep-link URL if the app was cold-started by tapping a push; else null. */
export async function getInitialNotificationUrl(): Promise<string | null> {
  const N = getNotifications();
  if (!N) return null;
  try {
    const response = await N.getLastNotificationResponseAsync();
    const url = response?.notification?.request?.content?.data?.url;
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

/** The OS-level platform string the backend's /api/devices expects. */
export function devicePlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

/** A friendly label for the "your devices" list, e.g. "Pixel 8". */
export function deviceLabel(): string | undefined {
  return Device.deviceName ?? undefined;
}
