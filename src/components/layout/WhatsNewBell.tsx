"use client";

/**
 * Header "what's new" indicator. A sparkle icon that carries an unread count
 * so shipped features get noticed instead of sitting undiscovered. The count is
 * server-computed and passed in; opening /dashboard/whats-new marks everything
 * read, so the badge clears on the next render.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";

export function WhatsNewBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/dashboard/whats-new"
      title={unread > 0 ? `${unread} new update${unread === 1 ? "" : "s"}` : "What's new"}
      aria-label={unread > 0 ? `What's new — ${unread} unread` : "What's new"}
      className="relative size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
    >
      <Sparkles className={`size-4 ${unread > 0 ? "text-brand-cyan" : ""}`} />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid place-items-center min-w-[16px] h-4 px-1 rounded-full bg-brand-cyan text-white text-[10px] font-bold leading-none tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
