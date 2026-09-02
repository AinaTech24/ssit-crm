"use client";

/**
 * The "enable 2FA" nudge for roles that can see PAN/KYC data. Rendered by the
 * dashboard layout, but hidden on full-height app screens (like the AI
 * assistant chat) where a banner would force the page to scroll.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";

/** Routes that manage their own full-viewport height — no top banner. */
const HIDE_ON = ["/dashboard/ai-assistant"];

export function PiiTwoFaBanner({ show }: { show: boolean }) {
  const pathname = usePathname() ?? "";
  if (!show) return null;
  if (HIDE_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <ShieldAlert className="size-4 shrink-0" />
      <span>Your role can access client PAN / KYC data. Protect it with two-factor authentication.</span>
      <Link href="/dashboard/settings/security" className="ml-auto font-semibold underline hover:no-underline">
        Enable 2FA →
      </Link>
    </div>
  );
}
