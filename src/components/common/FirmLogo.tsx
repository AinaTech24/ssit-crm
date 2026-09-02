"use client";

import { useState } from "react";

/**
 * Firm logo for letterheads / PDFs / headers. Built to render EVERY kind of
 * logo correctly:
 *
 *   - wide / landscape (e.g. "WE CARE")  → height-bound, width follows aspect
 *     ratio, capped by `maxWidth`; `object-fit: contain` so it is never stretched.
 *   - tall / portrait                    → bounded by `maxHeight` too, so it can
 *     never overflow the letterhead row.
 *   - square                             → fits the size box exactly.
 *   - broken / unreachable / invalid URL → `onError` swaps to the initials badge
 *     instead of showing the browser's broken-image glyph.
 *   - missing URL                        → initials badge.
 *
 * Keeping this in one client component means the `onError` fallback works even
 * though the print pages themselves are server components.
 */
export function FirmLogo({
  src,
  name,
  color = "#0f172a",
  size = 42,
  radius = 8,
  maxWidth,
}: {
  /** tenant.logoUrl — may be null/undefined/broken. */
  src?: string | null;
  /** firm display/legal name — first letter is the fallback badge. */
  name?: string | null;
  /** fallback badge background (tenant primary colour). */
  color?: string | null;
  /** target height (px). Width scales to keep the aspect ratio. */
  size?: number;
  /** corner radius (px). */
  radius?: number;
  /** max width (px) before a very wide logo is letter-boxed. Defaults to size×4. */
  maxWidth?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "M").trim().charAt(0).toUpperCase() || "M";
  const usableSrc = typeof src === "string" ? src.trim() : "";

  if (usableSrc && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={usableSrc}
        alt={name ? `${name} logo` : "Firm logo"}
        onError={() => setFailed(true)}
        style={{
          height: size,
          width: "auto",
          maxHeight: size,
          maxWidth: maxWidth ?? size * 4,
          objectFit: "contain",
          borderRadius: radius,
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-label={name ? `${name} logo` : "Firm logo"}
      style={{
        background: color || "#0f172a",
        color: "white",
        fontSize: Math.round(size * 0.42),
        fontWeight: 800,
        height: size,
        width: size,
        borderRadius: radius,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}
