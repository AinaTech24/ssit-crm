/**
 * Web ↔ native (Growth OS mobile app) bridge helpers.
 *
 * When the dashboard runs inside the React Native WebView, the shell injects
 * `window.__MFD_NATIVE__ = true` and a `window.GrowthOSNative` object exposing
 * native capabilities. On the regular web these are simply absent, so every
 * helper here degrades to a no-op / false — call them unconditionally and gate
 * UI on `isNativeApp()`.
 *
 * See mobile/components/DashboardWebView.tsx for the native side.
 */

type NativePickResult = {
  canceled?: boolean;
  error?: string;
  uri?: string;
  base64?: string;
  mimeType?: string;
  fileName?: string;
};

type GrowthOSNative = {
  isNative: boolean;
  pickImage: (options?: { source?: "camera" | "library"; quality?: number; allowsEditing?: boolean }) => Promise<NativePickResult>;
};

function bridge(): GrowthOSNative | null {
  if (typeof window === "undefined") return null;
  return (window as any).GrowthOSNative ?? null;
}

/** True only inside the mobile app's WebView. Safe on server + plain web. */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && (window as any).__MFD_NATIVE__ === true;
}

/**
 * Open the device camera (or photo library) and return the captured image as a
 * browser File ready to drop into any existing upload flow — same shape as a
 * file-input File, so callers reuse their normal FormData upload unchanged.
 *
 * Returns null if not in the app, the user cancelled, or capture failed.
 */
export async function nativePickImage(
  options: { source?: "camera" | "library" } = {}
): Promise<File | null> {
  const g = bridge();
  if (!g?.pickImage) return null;
  let res: NativePickResult;
  try {
    res = await g.pickImage(options);
  } catch {
    return null;
  }
  if (!res || res.canceled || res.error || !res.base64) return null;

  const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
  return new File([bytes], res.fileName ?? "scan.jpg", {
    type: res.mimeType ?? "image/jpeg",
  });
}
