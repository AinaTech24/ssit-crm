/**
 * Field visit check-in — capture the RM's GPS location when they're with a
 * client, so a logged visit carries where it happened. Uses expo-location, which
 * has a native implementation in Expo Go and a browser-geolocation shim on web.
 *
 * expo-location is required lazily and everything is guarded: if the module or
 * permission isn't available, check-in degrades to "no location" rather than
 * crashing — the visit still logs.
 */

export interface CheckinLocation { lat: number; lng: number; label: string | null }

/** Best-effort current location + a human label (reverse-geocoded). Returns null
 *  if location is unavailable or the user declines permission. */
export async function getCheckinLocation(): Promise<CheckinLocation | null> {
  let Location: any;
  try {
    // Lazy require so a build without the native module never crashes at import.
    Location = require("expo-location");
  } catch {
    return null;
  }
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
    const lat = pos?.coords?.latitude;
    const lng = pos?.coords?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;

    let label: string | null = null;
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const p = places?.[0];
      if (p) {
        // "Andheri East, Mumbai" style — locality + city, skipping empties.
        label = [p.name || p.street, p.district || p.subregion, p.city].filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).slice(0, 2).join(", ") || null;
      }
    } catch {
      /* reverse-geocode is a nicety; the coords are what matter */
    }
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), label };
  } catch {
    return null;
  }
}
