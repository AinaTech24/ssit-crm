import Link from "next/link";
import { Inbox } from "lucide-react";

/**
 * Shared empty-state for dashboard sections — replaces bare "0"/blank panels
 * with a friendly message and an optional call-to-action. Server-safe.
 */
export function DashboardEmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  cta,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  cta?: { href: string; label: string };
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center rounded-lg border border-dashed border-border bg-secondary/30 ${
        compact ? "py-6 px-4" : "py-10 px-6"
      }`}
    >
      <div className="size-9 rounded-full bg-secondary grid place-items-center mb-2">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{hint}</p>}
      {cta && (
        <Link href={cta.href} className="mt-3 btn-secondary text-xs">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
