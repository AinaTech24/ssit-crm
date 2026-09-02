import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Reduce a raw phone string to its national 10-digit Indian mobile, or null if
 * it doesn't look like one. Tolerates +91 / 91 / leading-0 prefixes and any
 * spacing/punctuation. Used for display formatting + validity flagging.
 */
export function indianMobile10(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  // A valid Indian mobile is exactly 10 digits starting 6–9.
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** True when the value parses to a plausible Indian mobile number. */
export function isValidIndianMobile(raw: string | null | undefined): boolean {
  return indianMobile10(raw) != null;
}

/**
 * Human-friendly phone display. A valid Indian mobile renders as
 * "+91 98765 43210"; anything else is returned trimmed as-is so we never hide
 * what was actually stored (the caller can flag it invalid separately).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = indianMobile10(raw);
  if (m) return `+91 ${m.slice(0, 5)} ${m.slice(5)}`;
  return String(raw).trim();
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(date);
}
