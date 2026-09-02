"use client";

/**
 * PanReveal — shows a masked PAN (ABC••••1E) by default with a click-to-reveal
 * toggle, so PAN isn't exposed on screen-shares / over-the-shoulder by default
 * (DPDP hygiene) while staying one click away for the RM.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PanReveal({ pan }: { pan: string | null | undefined }) {
  const [show, setShow] = useState(false);
  if (!pan) return null;
  const masked = pan.length >= 10 ? `${pan.slice(0, 3)}••••${pan.slice(-2)}` : "••••••";
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      {show ? pan : masked}
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide PAN" : "Reveal PAN"}
        title={show ? "Hide PAN" : "Reveal PAN"}
        className="text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </span>
  );
}
