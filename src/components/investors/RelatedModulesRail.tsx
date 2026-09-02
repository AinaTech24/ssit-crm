"use client";

/**
 * Related Modules rail (Sanchay parity) — a collapsible right-edge launcher
 * for the Client 360. Lists the client's related record collections with live
 * counts; clicking scrolls to that section on the page, and the optional "+"
 * deep-links to create a new related record.
 *
 * Jumps by CSS selector (section id or data-rl-section) so it works with the
 * existing RelatedLists sections without restructuring the page.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Layers, X, Plus, ChevronRight } from "lucide-react";

export type RelatedModuleItem = {
  label: string;
  /** On-page: CSS selector to scroll to (e.g. "#rel-folios"). */
  selector?: string;
  /** Off-page: navigate to another module instead of scrolling. */
  href?: string;
  count?: number;
  createHref?: string;
};

export function RelatedModulesRail({ items }: { items: RelatedModuleItem[] }) {
  const [open, setOpen] = useState(false);

  function jump(selector: string) {
    if (typeof document === "undefined") return;
    const el = document.querySelector(selector);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  }

  const total = items.reduce((n, i) => n + (i.count ?? 0), 0);

  return (
    <>
      {/* Edge tab — always visible on the right */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/3 z-30 bg-card text-muted-foreground border border-r-0 border-border rounded-l-lg shadow-sm px-1.5 py-3 hover:text-foreground hover:bg-secondary transition-colors"
        style={{ writingMode: "vertical-rl" }}
        title="Related modules"
        aria-label="Related modules"
      >
        <span className="text-[11px] font-semibold tracking-wide">Related Modules</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex justify-end" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-72 max-w-[85vw] h-full bg-card border-l border-border shadow-2xl flex flex-col"
          >
            <div className="px-4 py-3 border-b flex items-center justify-between bg-secondary/30">
              <div className="font-semibold text-sm flex items-center gap-2">
                <Layers className="size-4 text-brand-cyan" /> Related Modules
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <ul className="flex-1 overflow-y-auto divide-y">
              {items.map((it) => {
                const rowClass =
                  "flex-1 flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-accent text-left";
                const inner = (
                  <>
                    <span className="text-sm truncate">{it.label}</span>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      {it.count !== undefined && (
                        <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground min-w-[1.5rem] text-center">
                          {it.count}
                        </span>
                      )}
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </span>
                  </>
                );
                return (
                  <li key={it.label} className="flex items-center">
                    {it.href ? (
                      <Link href={it.href} onClick={() => setOpen(false)} className={rowClass}>
                        {inner}
                      </Link>
                    ) : (
                      <button onClick={() => it.selector && jump(it.selector)} className={rowClass}>
                        {inner}
                      </button>
                    )}
                    {it.createHref && (
                      <Link
                        href={it.createHref}
                        onClick={() => setOpen(false)}
                        className="px-3 self-stretch flex items-center text-muted-foreground hover:text-brand-cyan-deep border-l"
                        title={`Add ${it.label}`}
                      >
                        <Plus className="size-4" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="px-4 py-2.5 border-t bg-card text-[11px] text-muted-foreground">
              {total} related record{total === 1 ? "" : "s"} across {items.length} modules
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
