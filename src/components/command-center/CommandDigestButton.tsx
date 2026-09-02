"use client";

import { useState } from "react";
import { Mail, Loader2, Check } from "lucide-react";

/**
 * "Email me this briefing" — sends the current user a snapshot of their
 * Command Center queue (their morning digest, on demand). The daily scheduled
 * version can call the same endpoint from a cron.
 */
export function CommandDigestButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send() {
    setState("sending");
    try {
      const r = await fetch("/api/command-center/digest", { method: "POST" });
      setState(r.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={state === "sending"}
      className="btn-secondary text-xs inline-flex items-center gap-1.5"
      title="Email me a snapshot of this queue"
    >
      {state === "sending" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : state === "sent" ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Mail className="size-3.5" />
      )}
      {state === "sent" ? "Sent" : state === "error" ? "Failed" : "Email briefing"}
    </button>
  );
}
