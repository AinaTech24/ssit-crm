import Link from "next/link";
import { LucideIcon, Sparkles } from "lucide-react";

/**
 * EmptyState — the friendly "nothing here yet" UI that appears on list pages
 * when there are zero rows. Designed for non-technical users: a clear next
 * step ("Add your first lead"), a brief tip explaining *why* you'd want to,
 * and (optionally) a secondary "Import from Excel" path.
 *
 * Replaces blank tables that confuse new users. Use everywhere we render a
 * list and the array could be empty.
 */
type Props = {
  icon?: LucideIcon;
  title: string;
  /** 1–2 sentences explaining what this page is and the value of using it. */
  description: string;
  /** Plain-English tip pinned at the bottom. */
  tip?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
  /** Optional learn-more link to /dashboard/help#<anchor> */
  learnMoreAnchor?: string;
};

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  tip,
  primary,
  secondary,
  learnMoreAnchor,
}: Props) {
  return (
    <div className="card-elevated p-10 text-center max-w-2xl mx-auto">
      <div className="size-16 mx-auto rounded-2xl brand-gradient grid place-items-center shadow-lg">
        <Icon className="size-8 text-white" />
      </div>
      <h2 className="text-xl font-bold mt-5 tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto text-sm leading-relaxed">
        {description}
      </p>

      {(primary || secondary) && (
        <div className="mt-6 flex gap-2 justify-center flex-wrap">
          {primary && (
            <Link href={primary.href} className="btn-primary">
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className="btn-secondary">
              {secondary.label}
            </Link>
          )}
        </div>
      )}

      {tip && (
        <div className="mt-6 inline-flex items-start gap-2 text-left text-xs text-muted-foreground bg-secondary/60 border border-border/60 rounded-lg px-3 py-2 max-w-md">
          <span className="font-semibold text-brand-cyan-deep">Tip:</span>
          <span className="leading-relaxed">{tip}</span>
        </div>
      )}

      {learnMoreAnchor && (
        <div className="mt-4">
          <Link
            href={`/dashboard/help#${learnMoreAnchor}`}
            className="text-xs text-brand-cyan hover:underline"
          >
            Not sure what this means? Read the quick guide →
          </Link>
        </div>
      )}
    </div>
  );
}
