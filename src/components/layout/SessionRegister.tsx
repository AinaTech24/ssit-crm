"use client";

/**
 * Fire-and-forget: registers the current device session on app load so it shows
 * up under "your devices" and in presence — self-heals sessions that were
 * issued before device-tracking shipped (no reload; the re-issued cookie with a
 * sid takes effect on the next navigation). Idempotent + cheap server-side.
 */

import { useEffect } from "react";

export function SessionRegister() {
  useEffect(() => {
    fetch("/api/me/session/register", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
