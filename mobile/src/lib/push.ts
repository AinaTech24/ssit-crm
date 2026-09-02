/**
 * Push notifications — register this device's Expo push token so the server can
 * send a morning briefing ("3 meetings, 5 follow-ups today") and alerts.
 *
 * Everything is guarded and best-effort. Remote push requires a DEVELOPMENT
 * BUILD with an EAS projectId configured (Expo Go dropped remote push in SDK 53+,
 * and web has no Expo push); until then this silently no-ops rather than throwing.
 * The moment a dev build exists, registration starts working with no code change.
 */

import { Platform } from "react-native";
import { storageGet, storageSet } from "./storage";
import { PUSH_TOKEN_KEY } from "../config";
import { registerDevice } from "../api";

let configured = false;

/** Install the foreground-notification handler once (safe on every platform). */
export function configurePushHandler(): void {
  if (configured) return;
  configured = true;
  try {
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch {
    /* module unavailable — nothing to configure */
  }
}

/**
 * Ask permission, obtain the Expo push token, and register it with the backend.
 * Call after sign-in. No-ops on web, in Expo Go (SDK 53+), or without an EAS
 * projectId — returns null in all those cases.
 */
export async function registerForPush(sessionToken: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  let Notifications: any;
  let Constants: any;
  try {
    Notifications = require("expo-notifications");
    Constants = require("expo-constants").default;
  } catch {
    return null;
  }

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    // Android needs a channel for notifications to display.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      }).catch(() => {});
    }

    // projectId is required for a token; absent without EAS/a dev build.
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return null;

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenResp?.data;
    if (!expoPushToken) return null;

    // Avoid re-registering an unchanged token every launch.
    const prev = await storageGet(PUSH_TOKEN_KEY);
    if (prev !== expoPushToken) {
      await registerDevice(sessionToken, {
        expoPushToken,
        platform: Platform.OS === "ios" ? "ios" : "android",
        deviceName: Constants?.deviceName ?? undefined,
        appVersion: Constants?.expoConfig?.version ?? undefined,
      });
      await storageSet(PUSH_TOKEN_KEY, expoPushToken);
    }
    return expoPushToken;
  } catch {
    // Any failure (Expo Go, no projectId, network) is non-fatal.
    return null;
  }
}
