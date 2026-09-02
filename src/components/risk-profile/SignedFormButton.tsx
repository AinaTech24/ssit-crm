"use client";

/**
 * Opens the signed risk-profile form attached via the "upload signature"
 * sign-off route.
 *
 * Fetches a short-lived presigned URL first rather than linking straight at
 * /api/… — the project rule is that API routes never appear in an <a href>
 * (it leaks the route in the status bar), and the presigned URL expires.
 */

import { useState } from "react";
import { FileSignature, Loader2 } from "lucide-react";

export function SignedFormButton({ profileId }: { profileId: string }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch(`/api/risk-profiles/${profileId}/document`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "Could not open the signed form");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      /* the button is a convenience; failure is visible by nothing opening */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void open();
      }}
      disabled={busy}
      title="Open the signed form"
      aria-label="Open the signed form"
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />}
    </button>
  );
}
