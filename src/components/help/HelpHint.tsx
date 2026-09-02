"use client";

/**
 * HelpHint — a small (?) icon that reveals a plain-English explanation on
 * hover/tap. Designed for non-technical MFDs encountering jargon like ARN,
 * KYC, UCC, CAN, NAV, AUM, RIA, etc. without leaving the page.
 *
 * Usage:
 *   <label>ARN <HelpHint term="ARN" /></label>
 *   <label>UCC <HelpHint>The 10-digit unique client code…</HelpHint></label>
 *
 * If a `term` matches the built-in glossary, no `children` is required.
 */
import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { GLOSSARY } from "@/lib/help/glossary";

type Props = {
  term?: string;
  children?: React.ReactNode;
  className?: string;
};

export function HelpHint({ term, children, className }: Props) {
  const [open, setOpen] = useState(false);
  const fallback = term && GLOSSARY[term.toUpperCase()];
  const body = children ?? (fallback ? fallback.short : null);
  if (!body) return null;

  return (
    <span className={`relative inline-flex items-center ${className ?? ""}`}>
      <button
        type="button"
        aria-label={`What is ${term ?? "this"}?`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="ml-1 inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-brand-cyan transition-colors"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          // Anchor the tooltip's LEFT edge to the icon so it always opens to the
          // right — a centered popup (left-1/2 -translate-x-1/2) overflowed and
          // clipped when the field sat near a panel's left edge.
          className="absolute left-0 top-full mt-2 z-50 w-64 max-w-[min(16rem,75vw)] rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
        >
          {term && (
            <span className="block text-[10px] font-bold uppercase tracking-wider text-brand-cyan mb-1">
              {term}
            </span>
          )}
          <span className="block leading-relaxed">{body}</span>
        </span>
      )}
    </span>
  );
}
