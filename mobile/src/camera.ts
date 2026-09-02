/**
 * Native image capture for the WebView bridge. The web app calls
 * `window.GrowthOSNative.pickImage()` (defined in DashboardWebView); that posts
 * a message which lands here. We open the OS camera or photo library, then hand
 * the picked image back to the web as base64 so the existing web upload code can
 * build a File and POST it to the normal `/api/upload-*` route — no native
 * upload logic, no change to the web upload flow.
 *
 * SDK 56: mediaTypes uses the array form (['images']).
 */

import * as ImagePicker from "expo-image-picker";

export type PickOptions = {
  /** "camera" opens the camera; anything else opens the photo library. */
  source?: "camera" | "library";
  /** JPEG compression 0..1 (default 0.7 — KYC docs don't need full resolution). */
  quality?: number;
  /** Let the user crop/rotate before returning (good for document framing). */
  allowsEditing?: boolean;
};

export type PickResult =
  | { canceled: true }
  | { error: string }
  | {
      uri: string;
      base64: string;
      mimeType: string;
      fileName: string;
    };

export async function pickImage(options: PickOptions = {}): Promise<PickResult> {
  const useCamera = options.source === "camera";

  // Permissions — expo-image-picker shows the OS prompt; we just gate on the result.
  const perm = useCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { error: "permission_denied" };

  const args: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: options.quality ?? 0.7,
    allowsEditing: options.allowsEditing ?? false,
    base64: true,
  };

  try {
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(args)
      : await ImagePicker.launchImageLibraryAsync(args);

    if (result.canceled || !result.assets?.length) return { canceled: true };

    const asset = result.assets[0];
    if (!asset.base64) return { error: "no_image_data" };

    const mimeType = asset.mimeType ?? "image/jpeg";
    const ext = mimeType.split("/")[1] ?? "jpg";
    const fileName = asset.fileName ?? `capture.${ext}`;

    return { uri: asset.uri, base64: asset.base64, mimeType, fileName };
  } catch {
    return { error: "picker_failed" };
  }
}
