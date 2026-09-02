"use client";

/**
 * Toolbar entry point for AI pairing suggestions.
 *
 * The panel used to sit in a permanent right-hand column on /dashboard/families,
 * costing a third of the page width on every visit for a list most users act on
 * occasionally. It now lives behind this button: the table gets the full width,
 * and the suggestions open in a dialog on demand.
 *
 * The badge count is fetched up front (cheap, and it's the reason to click), but
 * the list itself only mounts when the dialog opens — so the heavier render is
 * deferred rather than paid on every page load.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { FamilySuggestionsPanel } from "@/components/families/FamilySuggestionsPanel";

export function FamilySuggestionsLauncher() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/families/suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setCount(j?.suggestions?.length ?? 0); })
      .catch(() => { if (!cancelled) setCount(0); });
    return () => { cancelled = true; };
  }, []);

  // Identity-stable so the panel's reporting effect doesn't re-run every render.
  const handleCountChange = useCallback((n: number) => setCount(n), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="AI pairing suggestions"
        className="rounded-md border border-violet-300 bg-violet-50 text-violet-800 px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-violet-100"
      >
        <Sparkles className="size-4" />
        AI pairing
        {count !== null && count > 0 && (
          <span className="ml-0.5 rounded-full bg-violet-600 text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums">
            {count}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-violet-500" />
              AI pairing suggestions
              {count !== null && count > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium">
                  {count} {count === 1 ? "match" : "matches"}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Unlinked investors that look like they belong to an existing household — matched on
              shared email, address and surname.
            </DialogDescription>
          </DialogHeader>
          {open && <FamilySuggestionsPanel onCountChange={handleCountChange} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
