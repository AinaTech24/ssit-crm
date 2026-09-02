"use client";

/**
 * ContactQuickActions — inline click-to-message icons (Sanchay parity).
 *
 * Renders compact WhatsApp / SMS / Email / Call launchers next to a phone or
 * email anywhere in the app (list rows, detail headers, the Celebrations
 * worklist). These open the RM's *own* WhatsApp / dialer / mail client with a
 * pre-filled message — a personal, compliance-safe touch that does NOT consume
 * our WhatsApp (Vartify) template quota. For templated/bulk sends, use the comms
 * pipeline instead.
 *
 * Drop-in:
 *   <ContactQuickActions phone={i.phone} email={i.email} message={`Hi ${i.name},`} />
 */

import { MessageCircle, MessageSquare, Mail, Phone } from "lucide-react";

/** Keep digits only; assume a bare 10-digit number is Indian (+91) for wa.me. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function ContactQuickActions({
  phone,
  email,
  message,
  subject,
  size = 14,
  className = "",
  show = ["whatsapp", "sms", "email", "call"],
}: {
  phone?: string | null;
  email?: string | null;
  message?: string;
  subject?: string;
  size?: number;
  className?: string;
  show?: Array<"whatsapp" | "sms" | "email" | "call">;
}) {
  const hasPhone = !!phone && phone.replace(/\D/g, "").length >= 7;
  const hasEmail = !!email && email.includes("@");
  const enc = (s?: string) => encodeURIComponent(s ?? "");
  // Don't let a click bubble to a row-level <Link>/navigation.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cls = "inline-grid place-items-center size-6 rounded hover:bg-secondary text-muted-foreground transition-colors";

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} onClick={stop}>
      {show.includes("whatsapp") && hasPhone && (
        <a
          href={`https://wa.me/${waNumber(phone!)}${message ? `?text=${enc(message)}` : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${cls} hover:text-emerald-600`}
          title="WhatsApp"
          aria-label="WhatsApp"
        >
          <MessageCircle style={{ width: size, height: size }} />
        </a>
      )}
      {show.includes("sms") && hasPhone && (
        <a
          href={`sms:${phone}${message ? `?body=${enc(message)}` : ""}`}
          className={`${cls} hover:text-blue-600`}
          title="SMS"
          aria-label="SMS"
        >
          <MessageSquare style={{ width: size, height: size }} />
        </a>
      )}
      {show.includes("email") && hasEmail && (
        <a
          href={`mailto:${email}${subject || message ? `?subject=${enc(subject)}&body=${enc(message)}` : ""}`}
          className={`${cls} hover:text-violet-600`}
          title="Email"
          aria-label="Email"
        >
          <Mail style={{ width: size, height: size }} />
        </a>
      )}
      {show.includes("call") && hasPhone && (
        <a
          href={`tel:${phone}`}
          className={`${cls} hover:text-foreground`}
          title="Call"
          aria-label="Call"
        >
          <Phone style={{ width: size, height: size }} />
        </a>
      )}
    </span>
  );
}
