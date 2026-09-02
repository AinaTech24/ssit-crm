"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ScanText, Search, BrainCircuit, ShieldCheck, CheckCircle2, Loader2, Sparkles } from "lucide-react";

/**
 * Live visual timeline shown while a policy document is being read & understood.
 * The extraction is a single opaque request, so the stages advance on the shared
 * `progress` estimate (driven by the page). Each active stage rotates through a
 * stream of "AI insight" lines so the user sees *what* is being figured out
 * (separating policyholder from agent, reading the premium table, etc.).
 */

type Stage = { key: string; label: string; icon: any; at: number; insights: string[] };

const STAGES: Stage[] = [
  {
    key: "read",
    label: "Reading the document",
    icon: FileText,
    at: 0,
    insights: ["Detecting file type…", "Opening the pages…", "Checking for a text layer…"],
  },
  {
    key: "text",
    label: "Extracting the text",
    icon: ScanText,
    at: 16,
    insights: ["Pulling the embedded text…", "Running OCR where it's a scan…", "Merging broken lines & cleaning headers…"],
  },
  {
    key: "candidates",
    label: "Finding the key values",
    icon: Search,
    at: 38,
    insights: ["Spotting every email & phone number…", "Locating PAN / GSTIN / UIN…", "Collecting policy numbers, dates & amounts…"],
  },
  {
    key: "ai",
    label: "AI understanding the policy",
    icon: BrainCircuit,
    at: 56,
    insights: [
      "Separating the policyholder from the agent…",
      "Ignoring support & customer-care contacts…",
      "Mapping the insured-member table…",
      "Reading the premium & cover breakdown…",
      "Matching nominee details…",
      "Telling the proposer apart from the holder…",
    ],
  },
  {
    key: "validate",
    label: "Validating & filling the form",
    icon: ShieldCheck,
    at: 84,
    insights: ["Checking PAN / email / date formats…", "Scoring confidence per field…", "Filling the form for your review…"],
  },
];

export function ExtractionTimeline({ progress }: { progress: number }) {
  const done = progress >= 100;
  // The furthest stage whose threshold we've passed is the active one.
  const activeIdx = done ? STAGES.length - 1 : STAGES.reduce((acc, s, i) => (progress >= s.at ? i : acc), 0);

  // Rotate the active stage's insight lines.
  const [tick, setTick] = useState(0);
  const lastActive = useRef(activeIdx);
  useEffect(() => {
    if (lastActive.current !== activeIdx) { lastActive.current = activeIdx; setTick(0); }
  }, [activeIdx]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, []);

  const active = STAGES[activeIdx];
  const insight = done ? "Done — review the highlighted fields." : active.insights[tick % active.insights.length];

  return (
    <div className="w-full max-w-md mx-auto text-left">
      {/* Header — overall progress */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-brand-cyan" /> Understanding your policy
        </div>
        <span className="text-brand-cyan-deep tabular-nums text-sm font-medium">{Math.min(100, Math.round(progress))}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-4">
        <div className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-cyan-deep transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, progress)}%` }} />
      </div>

      {/* Timeline */}
      <ul className="space-y-0">
        {STAGES.map((s, i) => {
          const state: "done" | "active" | "pending" = done || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          const Icon = s.icon;
          const isLast = i === STAGES.length - 1;
          return (
            <li key={s.key} className="flex gap-3">
              {/* Node + connector */}
              <div className="flex flex-col items-center">
                <div
                  className={`relative grid place-items-center size-8 rounded-full border transition-colors duration-300 ${
                    state === "done"
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : state === "active"
                      ? "bg-brand-cyan-light border-brand-cyan text-brand-cyan-deep"
                      : "bg-secondary border-border text-muted-foreground"
                  }`}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="size-4" />
                  ) : state === "active" ? (
                    <Icon className="size-4 animate-pulse" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                  {state === "active" && <span className="absolute size-8 rounded-full border-2 border-brand-cyan/40 animate-ping" />}
                </div>
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-[1.25rem] my-1 rounded ${i < activeIdx || done ? "bg-emerald-400" : "bg-border"}`} />
                )}
              </div>

              {/* Label + live insight */}
              <div className={`pb-3 ${isLast ? "" : ""} flex-1 min-w-0`}>
                <div className={`text-sm font-medium leading-8 ${state === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
                  {s.label}
                  {state === "active" && <Loader2 className="inline size-3.5 ml-1.5 animate-spin text-brand-cyan align-[-2px]" />}
                </div>
                {state === "active" && (
                  <div key={insight} className="text-xs text-muted-foreground mt-0.5 animate-[fadeIn_.4s_ease]">
                    {insight}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
