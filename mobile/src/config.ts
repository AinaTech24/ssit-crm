/**
 * App-wide configuration.
 *
 * API_BASE_URL is the ONE thing you change per environment:
 *   - Production:        https://crm.ssit.com
 *   - Local web dev:     http://<your-LAN-ip>:3000   (NOT localhost — the phone
 *                        is a different device; localhost would point at itself)
 *
 * Everything the app does — auth, the dashboard WebView, push registration —
 * hangs off this single origin, because the mobile app talks to the exact same
 * Next.js backend as the web app.
 */
import { Platform } from "react-native";
/**
 * Your laptop's LAN IP, for testing against the local Next.js dev server
 * (`npm run dev` on port 3000). The phone is a separate device, so this can't be
 * `localhost`. Update if your network assigns a different address.
 */
const LAN_IP = "192.168.29.125";

/**
 * Flip to `true` ONLY when testing against your local `npm run dev` server
 * (requires the server running + firewall open + your user in the local DB).
 * Default `false` → production, so you log in with your real credentials.
 *
 * NOTE: `false` means this build talks to the LIVE system — real clients, real
 * money, real sends. Anything you do in the app is done for real.
 */
const USE_LOCAL_DEV_SERVER = false;

// On the browser web preview, the "device" IS this machine, so localhost:3000
// is reachable and correct; on a physical phone we must use the LAN IP.
const DEV_HOST = Platform.OS === "web" ? "localhost" : LAN_IP;

export const API_BASE_URL = USE_LOCAL_DEV_SERVER
  ? `http://${DEV_HOST}:3000`
  : "https://crm.ssit.com";

/** The dashboard URL the WebView loads after login. */
export const DASHBOARD_URL = `${API_BASE_URL}/dashboard`;

/** SecureStore key under which the session JWT lives in the device keychain. */
export const TOKEN_KEY = "mfd_session_token";

/** SecureStore key for this device's Expo push token (so logout can unregister it). */
export const PUSH_TOKEN_KEY = "expo_push_token";
