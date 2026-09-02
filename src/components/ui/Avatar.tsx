"use client";

/**
 * Avatar — round photo with graceful initials fallback. `src` is a same-origin
 * serving URL (e.g. /api/investors/[id]/avatar) or any image URL; if it's
 * missing or fails to load, the person's initials are shown instead.
 */

import { useState } from "react";

function initialsOf(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({
  src,
  name,
  size = 36,
  className = "",
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;
  return (
    <span
      className={`inline-grid place-items-center rounded-full overflow-hidden bg-brand-cyan/10 text-brand-cyan-deep font-bold shrink-0 select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-label={name ?? "avatar"}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={name ?? ""}
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  );
}
