"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Command,
  PlusCircle,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ProductTour — a lightweight, dependency-free first-run coachmark tour.
 *
 * Runs ONCE on a new user's first dashboard visit (gated by a localStorage
 * flag), spotlighting the key surfaces so a feature-rich CRM doesn't overwhelm.
 *
 * The parent mounts this in the dashboard layout and is responsible for adding
 * the `data-tour="..."` anchor attributes to the real DOM elements. This file
 * only reads those anchors — it never assumes they exist and skips any that
 * are missing.
 */

const STORAGE_KEY = "ssit-tour-v1";
const RESTART_EVENT = "ssit-tour-restart";

type Placement = "top" | "bottom";

interface Step {
  /** matches the [data-tour="..."] attribute the parent renders */
  anchor: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** preferred tooltip placement relative to the anchor */
  prefer: Placement;
}

const STEPS: Step[] = [
  {
    anchor: "sidebar",
    icon: Sparkles,
    title: "Your menu",
    body: "Everything lives here — but you don't need most of it every day. You can ⭐ pin your favourites to the top.",
    prefer: "bottom",
  },
  {
    anchor: "global-search",
    icon: Search,
    title: "Search anything",
    body: "Find a client, a lead or a folio number — from anywhere in the app.",
    prefer: "bottom",
  },
  {
    anchor: "command-hint",
    icon: Command,
    title: "The command bar",
    body: "Press Ctrl K (⌘K on Mac) to jump to any screen or create anything, instantly. It's the fastest way to move around.",
    prefer: "bottom",
  },
  {
    anchor: "quick-create",
    icon: PlusCircle,
    title: "Quick create",
    body: "One click to add a lead, client, task, meeting or proposal — from any page.",
    prefer: "top",
  },
  {
    anchor: "notifications",
    icon: Bell,
    title: "Notifications",
    body: "Reminders, birthdays and alerts land here. Your 8 AM briefing summarises the day too.",
    prefer: "bottom",
  },
];

/**
 * Clears the "seen" flag and reloads so the tour runs again.
 * Wire this to a "Take the tour again" menu item anywhere.
 */
export function restartProductTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage errors (private mode, etc.) */
  }
  // If the component is already mounted this turn, let it react live;
  // a reload is the simplest reliable path though.
  try {
    window.dispatchEvent(new CustomEvent(RESTART_EVENT));
  } catch {
    /* no-op */
  }
  window.location.reload();
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // spotlight padding around the anchor
const GAP = 12; // gap between spotlight and tooltip
const CARD_W = 320;

export default function ProductTour() {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Decide whether to run at all (first visit only), after the layout paints.
  useEffect(() => {
    let seen = false;
    try {
      seen = Boolean(localStorage.getItem(STORAGE_KEY));
    } catch {
      seen = true; // if storage is unavailable, don't nag
    }
    if (seen) return;

    const t = setTimeout(() => {
      setIndex(0);
      setActive(true);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  // Allow an in-page restart without a reload (belt-and-braces).
  useEffect(() => {
    const onRestart = () => {
      setIndex(0);
      setActive(true);
    };
    window.addEventListener(RESTART_EVENT, onRestart);
    return () => window.removeEventListener(RESTART_EVENT, onRestart);
  }, []);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, []);

  const close = useCallback(() => {
    markSeen();
    setActive(false);
    setRect(null);
  }, [markSeen]);

  // Advance to the next VISIBLE step. Steps whose anchor is missing are
  // skipped. If none remain, finish.
  const findFrom = useCallback((start: number, dir: 1 | -1): number => {
    for (let i = start; i >= 0 && i < STEPS.length; i += dir) {
      const el = document.querySelector(`[data-tour="${STEPS[i].anchor}"]`);
      if (el) return i;
    }
    return -1;
  }, []);

  // On activation, land on the first resolvable step.
  useEffect(() => {
    if (!active) return;
    const first = findFrom(0, 1);
    if (first === -1) {
      close();
      return;
    }
    setIndex(first);
  }, [active, findFrom, close]);

  const measure = useCallback(() => {
    if (!active) return;
    const el = document.querySelector(`[data-tour="${STEPS[index].anchor}"]`);
    if (!el) {
      // Anchor vanished (route change, responsive collapse) — try to move on.
      const next = findFrom(index + 1, 1);
      if (next === -1) {
        close();
      } else {
        setIndex(next);
      }
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    setIsMobile(window.innerWidth < 640);
  }, [active, index, findFrom, close]);

  // Measure synchronously before paint to avoid a flash at the wrong spot.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Keep the spotlight glued to the anchor on resize / scroll.
  useEffect(() => {
    if (!active) return;
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [active, measure]);

  const goNext = useCallback(() => {
    const next = findFrom(index + 1, 1);
    if (next === -1) {
      close();
    } else {
      setIndex(next);
    }
  }, [index, findFrom, close]);

  const goBack = useCallback(() => {
    const prev = findFrom(index - 1, -1);
    if (prev !== -1) setIndex(prev);
  }, [index, findFrom]);

  // Keyboard: Esc closes, arrows navigate.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close, goNext, goBack]);

  if (!active || !rect) return null;

  const step = STEPS[index];
  const Icon = step.icon;
  const isFirst = findFrom(index - 1, -1) === -1;
  const isLast = findFrom(index + 1, 1) === -1;

  // Spotlight box (anchor + padding, clamped to the viewport).
  const spot = {
    top: Math.max(rect.top - PAD, 4),
    left: Math.max(rect.left - PAD, 4),
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Tooltip placement: prefer the step's side, flip if there's no room.
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const roomBelow = vh - (spot.top + spot.height);
  const roomAbove = spot.top;
  const placeBottom =
    step.prefer === "bottom" ? roomBelow > 200 || roomBelow >= roomAbove : roomAbove < 200;

  // Horizontal position: align tooltip near the anchor, clamp to viewport.
  const rawLeft = spot.left + spot.width / 2 - CARD_W / 2;
  const clampedLeft = Math.min(Math.max(rawLeft, 12), vw - CARD_W - 12);

  // Tall anchors (e.g. the full-height sidebar) leave no room above OR below, so
  // above/below placement would shove the card off-screen. Detect that and place
  // the card BESIDE the spotlight instead (to the right if it fits, else left),
  // clamped fully into view.
  const tallAnchor = roomBelow < 180 && roomAbove < 180;
  const besideRight = spot.left + spot.width + GAP + CARD_W <= vw - 12;
  const besideLeft = spot.left - GAP - CARD_W >= 12;

  const cardStyle: React.CSSProperties = isMobile
    ? { left: 12, right: 12, bottom: 16, width: "auto", maxWidth: "none" }
    : tallAnchor && (besideRight || besideLeft)
      ? {
          top: Math.min(Math.max(spot.top + 8, 16), Math.max(vh - 260, 16)),
          left: besideRight ? spot.left + spot.width + GAP : spot.left - GAP - CARD_W,
          width: CARD_W,
        }
      : placeBottom
        ? { top: spot.top + spot.height + GAP, left: clampedLeft, width: CARD_W }
        : { top: Math.max(spot.top - GAP, 12), left: clampedLeft, width: CARD_W, transform: "translateY(-100%)" };

  return (
    <div
      className="fixed inset-0 z-[150]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssit-tour-title"
    >
      {/* Click-catcher: clicking the dim backdrop skips the tour. */}
      <button
        type="button"
        aria-label="Skip tour"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default"
        tabIndex={-1}
      />

      {/* Spotlight cutout — the huge box-shadow dims everything except the ring. */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-xl ring-2 ring-white/90 transition-all duration-200 ease-out shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
        style={{
          top: spot.top,
          left: spot.left,
          width: spot.width,
          height: spot.height,
        }}
      />

      {/* Tooltip card */}
      <div
        className={cn(
          "absolute z-[151] rounded-2xl border border-border bg-card text-foreground shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 duration-200",
        )}
        style={cardStyle}
      >
        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-cyan/10 text-brand-cyan">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3
                id="ssit-tour-title"
                className="text-sm font-semibold leading-tight text-foreground"
              >
                {step.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close tour"
              className="btn-ghost -mr-1 -mt-1 h-7 w-7 shrink-0 rounded-full p-0"
            >
              <X className="mx-auto h-4 w-4" />
            </button>
          </div>

          {/* Footer: progress + navigation */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-hidden>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    i === index ? "w-4 bg-brand-cyan" : "w-1.5 bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="mr-1 text-xs tabular-nums text-muted-foreground">
                {index + 1} / {STEPS.length}
              </span>
              {!isFirst && (
                <button
                  type="button"
                  onClick={goBack}
                  className="btn-ghost inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={goNext}
                className="btn-primary inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold"
              >
                {isLast ? "Got it" : "Next"}
                {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="mt-2 text-center">
            <button
              type="button"
              onClick={close}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Skip tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
