"use client";

/**
 * Money Personality Quiz — an 8-question risk + behaviour profiler that returns
 * an archetype and a suggested asset allocation. A delightful onboarding /
 * lead-capture tool. Pure client-side scoring (no domain math import).
 */

import { useMemo, useState } from "react";
import { Insight, Section, Stat, Table } from "./ui";

type Q = { q: string; options: { label: string; score: number }[] };

const QUESTIONS: Q[] = [
  {
    q: "Your investment horizon for this money is…",
    options: [
      { label: "Under 3 years", score: 1 },
      { label: "3–7 years", score: 2 },
      { label: "7–15 years", score: 3 },
      { label: "15+ years", score: 4 },
    ],
  },
  {
    q: "Your portfolio drops 25% in a month. You…",
    options: [
      { label: "Sell everything — can't sleep", score: 1 },
      { label: "Sell some to feel safer", score: 2 },
      { label: "Hold and wait it out", score: 3 },
      { label: "Invest more — it's on sale", score: 4 },
    ],
  },
  {
    q: "What matters most to you?",
    options: [
      { label: "Never losing capital", score: 1 },
      { label: "Steady, predictable returns", score: 2 },
      { label: "Beating inflation comfortably", score: 3 },
      { label: "Maximum long-term growth", score: 4 },
    ],
  },
  {
    q: "Your monthly income is…",
    options: [
      { label: "Irregular / uncertain", score: 1 },
      { label: "Stable but tight", score: 2 },
      { label: "Stable with surplus", score: 3 },
      { label: "High and growing", score: 4 },
    ],
  },
  {
    q: "Your investing experience is…",
    options: [
      { label: "FDs & savings only", score: 1 },
      { label: "Some mutual funds", score: 2 },
      { label: "Regular equity investor", score: 3 },
      { label: "Confident across asset classes", score: 4 },
    ],
  },
  {
    q: "An emergency fund (6 months expenses) is…",
    options: [
      { label: "Not yet built", score: 1 },
      { label: "Partly built", score: 2 },
      { label: "Fully built", score: 3 },
      { label: "Built + extra buffer", score: 4 },
    ],
  },
  {
    q: "Which return would you pick?",
    options: [
      { label: "Guaranteed 6%", score: 1 },
      { label: "Likely 9%, small risk", score: 2 },
      { label: "Likely 12%, moderate swings", score: 3 },
      { label: "Maybe 15%, big swings", score: 4 },
    ],
  },
  {
    q: "Your age bracket is…",
    options: [
      { label: "55+", score: 1 },
      { label: "45–55", score: 2 },
      { label: "30–45", score: 3 },
      { label: "Under 30", score: 4 },
    ],
  },
];

type Profile = { name: string; tagline: string; equity: number; debt: number; gold: number; tone: "rose" | "amber" | "cyan" | "emerald" };

function profileFor(score: number): Profile {
  if (score <= 14) return { name: "The Cautious Preserver", tagline: "Safety first — protect capital, beat inflation slowly.", equity: 25, debt: 65, gold: 10, tone: "cyan" };
  if (score <= 20) return { name: "The Balanced Builder", tagline: "Steady growth with a comfort cushion.", equity: 50, debt: 40, gold: 10, tone: "emerald" };
  if (score <= 26) return { name: "The Confident Grower", tagline: "Growth-tilted; rides volatility for higher returns.", equity: 70, debt: 22, gold: 8, tone: "amber" };
  return { name: "The Aggressive Wealth-Creator", tagline: "Maximum long-term growth; unfazed by big swings.", equity: 85, debt: 10, gold: 5, tone: "rose" };
}

export function MoneyPersonalityQuiz() {
  const [clientName, setClientName] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>(Array(QUESTIONS.length).fill(null));

  const answeredCount = answers.filter((a) => a != null).length;
  const done = answeredCount === QUESTIONS.length;
  const score = useMemo(
    () => answers.reduce<number>((s, a, i) => (a != null ? s + QUESTIONS[i].options[a].score : s), 0),
    [answers],
  );
  const profile = done ? profileFor(score) : null;

  function pick(qi: number, oi: number) {
    setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
  }
  function reset() {
    setAnswers(Array(QUESTIONS.length).fill(null));
  }

  const alloc = profile
    ? [
        { label: "Equity", pct: profile.equity, color: "#10b981" },
        { label: "Debt", pct: profile.debt, color: "#0891b2" },
        { label: "Gold", pct: profile.gold, color: "#f59e0b" },
      ]
    : [];

  return (
    <div className="card-surface p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold">Money Personality Quiz</h2>
        <p className="text-xs text-muted-foreground">
          8 quick questions reveal an investor archetype and a starting asset mix. A great ice-breaker for a first meeting.
        </p>
      </div>


      <div className="space-y-4">
        {QUESTIONS.map((q, qi) => (
          <div key={qi} className="break-inside-avoid">
            <div className="text-sm font-medium mb-1.5">
              <span className="text-muted-foreground mr-1">{qi + 1}.</span>
              {q.q}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {q.options.map((o, oi) => (
                <button
                  key={oi}
                  type="button"
                  onClick={() => pick(qi, oi)}
                  className={`text-left rounded-md border px-2.5 py-1.5 text-xs transition ${
                    answers[qi] === oi
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Captured by the combined-report exporter (not shown) — the client's answers. */}
      {answeredCount > 0 && (
        <div hidden aria-hidden="true">
          {answers.map((a, i) =>
            a != null ? (
              <div
                key={i}
                data-pdf-input
                data-pdf-input-label={`Q${i + 1}. ${QUESTIONS[i].q}`}
                data-pdf-input-value={QUESTIONS[i].options[a].label}
              />
            ) : null,
          )}
        </div>
      )}

      {!done && (
        <div className="text-xs text-muted-foreground">
          {answeredCount}/{QUESTIONS.length} answered — finish all to reveal the profile.
        </div>
      )}

      {profile && (
        <Section n="★" title="Your money personality">
          <div
            className={`rounded-xl border p-5 text-center ${
              profile.tone === "rose"
                ? "border-rose-200 bg-rose-50/60"
                : profile.tone === "amber"
                  ? "border-amber-200 bg-amber-50/60"
                  : profile.tone === "cyan"
                    ? "border-primary/30 bg-primary/10"
                    : "border-emerald-200 bg-emerald-50/60"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {clientName ? `${clientName} is` : "You are"}
            </div>
            <div className="text-2xl font-extrabold mt-1">{profile.name}</div>
            <div className="text-xs text-muted-foreground mt-1">{profile.tagline}</div>
          </div>

          {/* Capturable result facts (Stat primitive → picked up by the PDF exporter). */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Profile" value={profile.name} tone={profile.tone} />
            <Stat label="Risk score" value={`${score} / ${QUESTIONS.length * 4}`} />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Suggested starting mix</div>
            <div className="flex h-8 w-full overflow-hidden rounded-md border border-border">
              {alloc.map((a, i) => (
                <div
                  key={i}
                  className="h-full flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ width: `${a.pct}%`, background: a.color }}
                >
                  {a.pct}%
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-2 text-[11px]">
              {alloc.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: a.color }} /> {a.label} {a.pct}%
                </span>
              ))}
            </div>
          </div>

          {/* Same mix as a table so it lands in the client PDF. */}
          <Table head={["Asset", "Suggested allocation"]} rows={alloc.map((a) => [a.label, `${a.pct}%`])} />

          <Insight tone={profile.tone}>
            A starting point, not a prescription. The final allocation should reflect {clientName || "the client"}&rsquo;s goals,
            timelines and tax position — exactly the conversation this quiz is designed to start.
          </Insight>

          <button type="button" onClick={reset} className="btn-ghost text-xs print:hidden">
            Retake quiz
          </button>
        </Section>
      )}
    </div>
  );
}
