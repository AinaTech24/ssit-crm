/**
 * WhatsApp — open the chat AND leave a record.
 *
 * Why not route through the comms pipeline? Business-API sends need a Meta-
 * approved template outside the 24h session window, so the free text an RM types
 * on the doorstep legally can't go that way. RMs send from their own WhatsApp —
 * that's the real workflow. What was missing is the RECORD: previously every
 * WhatsApp from this app vanished, so nobody could answer "what did we last tell
 * this client?" and nothing showed on the client's timeline.
 *
 * So: open wa.me exactly as before, and log an outbound `whatsapp` activity in
 * the background. Best-effort — a failed log must never block the message.
 *
 * NOTE: this is an interaction record, not a compliance-gated BSP send. Template
 * campaigns still go through dispatch() on the server.
 */

import { Linking } from "react-native";
import { queuedPost } from "../../lib/offlineQueue";

/** 10 digits → +91. Anything else is passed through as-is (already has a code). */
export function waNumber(phone?: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
}

export interface WhatsAppOpts {
  phone?: string | null;
  /** Pre-filled message. Omit for a blank chat. */
  text?: string;
  /** Who it's about — enables the timeline record. */
  subjectType?: "investor" | "lead" | "family" | null;
  subjectId?: string | null;
  name?: string | null;
  /** Short label for the log, e.g. "Birthday wish", "Follow-up". */
  purpose?: string;
}

/**
 * Opens WhatsApp and records the interaction. Returns false if there's no
 * usable number (caller can toast).
 */
export function openWhatsApp(opts: WhatsAppOpts): boolean {
  const n = waNumber(opts.phone);
  if (!n) return false;

  const url = opts.text ? `https://wa.me/${n}?text=${encodeURIComponent(opts.text)}` : `https://wa.me/${n}`;
  Linking.openURL(url).catch(() => {});

  // Fire-and-forget record. Only when we know who it's about — a log row with no
  // subject would be noise nobody can act on.
  if (opts.subjectType && opts.subjectId) {
    queuedPost(
      "/api/activities",
      {
        subjectType: opts.subjectType,
        subjectId: opts.subjectId,
        kind: "whatsapp",
        direction: "outbound",
        status: "completed",
        subject: opts.purpose ? `WhatsApp — ${opts.purpose}` : "WhatsApp message",
        notes: opts.text || undefined,
      },
      "WhatsApp log"
    ).catch(() => {
      /* never let logging break the send */
    });
  }
  return true;
}
