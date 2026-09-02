# Growth OS — Mobile App

A **hybrid** React Native (Expo) app for MFD staff. A thin native shell handles
login, secure session storage, and (soon) push + camera; the full dashboard —
all 65 modules — renders in a WebView of the existing Next.js backend. One web
app to maintain; every web feature appears in the app automatically.

## Architecture

```
App.tsx ──> AuthProvider ──┬─ no token  ─> LoginScreen   (native, /api/auth/mobile-login)
                           └─ has token ─> DashboardWebView (loads crm.ssit.com/dashboard)
```

The session JWT is stored in the device keychain (`expo-secure-store`) and sent
as `Authorization: Bearer <token>`. The backend's Edge middleware accepts that
header (added in Phase 0), so every one of the existing `/api/*` routes works
from the app with no per-route changes.

## Prerequisites

- Node 20+ and the Expo tooling (`npx expo` — no global install needed)
- The **Expo Go** app on your phone (iOS App Store / Google Play) for instant testing,
  OR Android Studio / Xcode for native builds
- The backend running and reachable (production `https://crm.ssit.com`, or your
  LAN dev server — see `src/config.ts`)

## First-time setup

```bash
cd mobile
npm install
# Native modules (already in package.json; this realigns them to the Expo SDK):
npx expo install react-native-webview expo-secure-store \
  expo-notifications expo-device expo-constants expo-local-authentication
```

## Run

```bash
npm start          # opens the Expo dev tools; scan the QR with Expo Go
# or target a platform directly:
npm run android
npm run ios        # macOS only for the simulator; Expo Go works from any OS
```

## Pointing at a local backend

The phone is a separate device, so `localhost` won't reach your laptop. In
`src/config.ts` set `API_BASE_URL` to your machine's LAN IP, e.g.
`http://192.168.1.20:3000`, and make sure the Next.js dev server is listening on
`0.0.0.0` and the firewall allows it.

> Note: a plain-HTTP dev URL needs an ATS/cleartext exception for a production
> build. It works in Expo Go for development as-is; production always uses HTTPS.

## Building & releasing (EAS)

Builds run in Expo's cloud — **no Mac needed for iOS**. `eas.json` defines three
profiles:

| Profile | Output | Use |
|---|---|---|
| `development` | dev client (APK / device build) | day-to-day testing **with push** |
| `preview` | internal APK / ipa | hand to your RMs to try |
| `production` | Android `.aab` + iOS store build | Play Store / App Store |

One-time:
```bash
npm i -g eas-cli
eas login            # your Expo account
eas init             # writes extra.eas.projectId into app.json (enables push)
```

Then build / submit:
```bash
eas build --profile development --platform android   # or ios / all
eas build --profile production  --platform all
eas submit --profile production  --platform all       # uploads to the stores
```

Accounts you'll need: **Google Play Developer** ($25 one-time) and **Apple
Developer** ($99/yr). EAS manages the signing certs for both.

## What's built (Phase 0–3)

- ✅ Native email/password login + 2FA code step
- ✅ Secure token storage + auto session refresh on launch
- ✅ Full dashboard in a WebView (all modules), Android back-button handling
- ✅ Auto sign-out when the web session dies
- ✅ **Push notifications** — device registers with `POST /api/devices`; the
  backend `send_push` workflow action delivers to it; tapping a push deep-links
  into the matching dashboard screen
- ✅ **Biometric unlock** (Face ID / fingerprint) on returning sessions
- ✅ Logout unregisters the device so a signed-out phone stops getting pushes

## Enabling push (one-time)

Push needs two things the shell already supports but that require your accounts:

1. **An EAS projectId.** Run `npx eas init` (after `npm i -g eas-cli` and
   `eas login`). It writes `extra.eas.projectId` into `app.json`. Until then,
   `registerForPush()` no-ops gracefully — the app still runs, just no token.
2. **A development build, not Expo Go.** Remote push stopped working in Expo Go
   from SDK 53. Build a dev client: `npx expo run:android` (local) or
   `eas build --profile development`. Then push works end-to-end.

> The app **detects Expo Go and no-ops all push code** (`isExpoGo` in
> `src/push.ts`), so Expo Go stays fully usable for testing login, the dashboard,
> biometrics, and the camera bridge — push simply activates once you're on a dev
> build. Without this guard, expo-notifications red-screens the app on launch.

Test delivery quickly with Expo's tool: https://expo.dev/notifications — paste a
device's token (log it from `registerForPush`) and send a test.

## Camera / file upload bridge (built)

The native shell exposes a small API to the web app — **no changes to the web
upload code are required**. When running inside the app, the web can detect
`window.__MFD_NATIVE__` and call:

```js
// In the web dashboard, on an "Upload KYC doc" button:
if (window.__MFD_NATIVE__ && window.GrowthOSNative) {
  const img = await window.GrowthOSNative.pickImage({ source: "camera" }); // or "library"
  if (img && !img.canceled) {
    // img = { base64, mimeType, fileName }
    const file = new File(
      [Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0))],
      img.fileName,
      { type: img.mimeType }
    );
    // …hand `file` to your existing upload (FormData → /api/upload-*).
  }
}
```

The native side opens the OS camera/library, returns the image as base64, and the
web turns it into a `File` and uploads it through the same route it already uses.
Wiring this into specific upload buttons on the web is the one remaining (small,
web-side) task.

## Next

- Add the `pickImage()` call to the web KYC/document upload buttons (web-side)
- Optionally nativize the top screens (Home/Clients/Tasks/Inbox) for snappier UX
