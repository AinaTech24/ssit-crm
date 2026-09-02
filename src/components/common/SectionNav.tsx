"use client";

/**
 * SectionNav — a sticky jump-nav for the Lead / Client 360 pages. Lists each
 * section's label; clicking smooth-scrolls to that section (the RelatedListSection
 * wrappers expose `[data-rl-module][data-rl-section]` anchors). The pill for the
 * section currently in view is highlighted (IntersectionObserver), with a brand
 * hover effect. Hidden/reordered sections are respected — we only show anchors
 * that are actually present and visible in the DOM.
 */

import { useEffect, useRef, useState } from "react";

type SectionItem = { key: string; label: string; required?: boolean };

export function SectionNav({ moduleKey, sections }: { moduleKey: string; sections: SectionItem[] }) {
  // Skip the always-on header (it's already at the top).
  const all = sections.filter((s) => !s.required);
  // Visible section keys IN PAGE ORDER. The "Customize page" manager reorders
  // sections via CSS `order`, so the nav must follow the on-page position — not
  // the static source order — and re-sort whenever the user reorders/hides.
  const [orderedKeys, setOrderedKeys] = useState<string[]>(all.map((s) => s.key));
  const [active, setActive] = useState<string>("");
  // Bumped when the customize prefs change so the order recomputes live.
  const [tick, setTick] = useState(0);
  // Edge-fade affordance: the pill row scrolls horizontally with a hidden
  // scrollbar, so without a cue the user can't tell a label is cut off
  // ("Transact…"). Track whether there's more content off each edge.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  function recomputeEdges() {
    const el = scrollerRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }

  function anchor(key: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-rl-module="${moduleKey}"][data-rl-section="${key}"]`);
  }

  function go(key: string) {
    const el = anchor(key);
    if (el) {
      // Centre the section in the viewport (not the top) so it's obvious which
      // section you jumped to — the old "block: start" tucked headings right
      // under the sticky nav, making the active section hard to spot.
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setActive(key);
    }
  }

  // Re-sort the pills whenever the "Customize page" manager changes prefs (it
  // dispatches `ssit:rl-prefs-changed`), so the nav order always mirrors the
  // page's reorder/hide choices.
  useEffect(() => {
    function onPrefs(e: Event) {
      const mk = (e as CustomEvent)?.detail?.moduleKey;
      if (!mk || mk === moduleKey) setTick((t) => t + 1);
    }
    window.addEventListener("ssit:rl-prefs-changed", onPrefs as EventListener);
    return () => window.removeEventListener("ssit:rl-prefs-changed", onPrefs as EventListener);
  }, [moduleKey]);

  useEffect(() => {
    // Compute order from the LIVE page layout: keep only sections that exist and
    // aren't hidden (display:none from Customize prefs), then sort by their
    // actual vertical position — which reflects the CSS `order` the manager sets.
    // rAF lets the manager's injected <style> settle before we read positions.
    let raf = 0;
    const compute = () => {
      const present = all
        .map((s) => ({ s, el: anchor(s.key) }))
        .filter((x) => x.el && getComputedStyle(x.el).display !== "none") as { s: SectionItem; el: HTMLElement }[];
      present.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
      setOrderedKeys(present.map((x) => x.s.key));

      const els = present.map((x) => x.el);
      if (!els.length) return;
      const obs = new IntersectionObserver(
        (entries) => {
          const top = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (top) setActive(top.target.getAttribute("data-rl-section") ?? "");
        },
        // Active = whichever section sits in the middle band of the viewport, so
        // the highlight matches the centre-scrolled section the user lands on.
        { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.25, 0.5, 1] }
      );
      els.forEach((el) => obs.observe(el));
      cleanup = () => obs.disconnect();
    };
    let cleanup: (() => void) | undefined;
    raf = requestAnimationFrame(compute);
    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, sections.length, tick]);

  const byKey = new Map(all.map((s) => [s.key, s]));
  const items = orderedKeys.map((k) => byKey.get(k)).filter(Boolean) as SectionItem[];

  // Recompute the edge fades whenever the visible pill set changes, and on
  // window resize (a narrower window may newly clip the row).
  useEffect(() => {
    recomputeEdges();
    const onResize = () => recomputeEdges();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Auto-scroll the pill row so the ACTIVE section's pill stays in view as the
  // user scrolls the page — centred horizontally, without nudging the page
  // vertically (scrollIntoView would; setting scrollLeft directly doesn't).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !active) return;
    const btn = scroller.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`);
    if (!btn) return;
    const target = btn.offsetLeft - scroller.clientWidth / 2 + btn.clientWidth / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    recomputeEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (items.length < 2) return null;

  return (
    // Stick just below the global glass topbar (h-16 = 64px) so the jump-nav
    // stays visible while scrolling instead of hiding underneath it.
    <div className="relative sticky top-[4.5rem] z-30 mb-2">
      <nav
        ref={scrollerRef}
        onScroll={recomputeEdges}
        className="flex gap-1.5 overflow-x-auto scrollbar-none rounded-xl border border-border bg-card/85 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/70 print:hidden"
      >
        {items.map((s) => (
          <button
            key={s.key}
            type="button"
            data-key={s.key}
            onClick={() => go(s.key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              active === s.key
                ? "bg-brand-cyan text-white shadow-sm"
                : "text-muted-foreground hover:-translate-y-px hover:bg-brand-cyan-light/50 hover:text-brand-cyan-deep"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {/* Edge fades — signal that more pills exist off-screen. */}
      {edges.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-xl bg-gradient-to-r from-card to-transparent print:hidden" />
      )}
      {edges.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-card to-transparent print:hidden" />
      )}
    </div>
  );
}
