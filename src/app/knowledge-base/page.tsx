/**
 * PUBLIC Knowledge Base hub — lists every published article (the KAIZEN series).
 * Everything is free to read; no login anywhere.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Clock, ArrowRight, HelpCircle } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { loadKbCards } from "@/lib/kb/articles";
import { PublicShell } from "@/components/kb/PublicShell";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "KAIZEN Knowledge Base | Equitywala for Mutual Fund Distributors",
  description:
    "Real situations from an Indian MFD's practice — a missed SIP, a dormant client, an audit query — and exactly how Equitywala handles each one. One improvement at a time.",
  alternates: { canonical: "/knowledge-base" },
};

export default async function KnowledgeBasePage() {
  const session = await getSession().catch(() => null);
  const cards = await loadKbCards();
  const kaizen = cards.filter((c) => c.series.toUpperCase() === "KAIZEN");
  const others = cards.filter((c) => c.series.toUpperCase() !== "KAIZEN");

  return (
    <PublicShell signedIn={!!session}>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-8">
        <span className="chip bg-brand-navy-light text-primary">改善 · KAIZEN — continuous improvement</span>
        <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground max-w-3xl">
          Real problems from a real MFD practice — and how the CRM solves each one
        </h1>
        <p className="mt-4 text-muted-foreground max-w-2xl leading-relaxed">
          Every entry starts with a situation you have probably lived through — then the step-by-step answer,
          with screenshots from the product. Free to read, no login.
        </p>
        {!session && (
          <p className="mt-4 text-sm text-muted-foreground">
            Every entry is free to read.{" "}
            <Link href="/signup" className="text-brand-cyan-deep font-semibold hover:underline">
              Start a free trial
            </Link>{" "}
            when you want to try it on your own book.
          </p>
        )}
      </section>

      {/* Cards */}
      <section className="max-w-6xl mx-auto px-6 pb-4">
        {kaizen.length === 0 && others.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <BookOpen className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-3 font-semibold">The first KAIZEN entry is on its way.</div>
            <p className="text-sm text-muted-foreground mt-1">
              Check back shortly — or{" "}
              <Link href="/signup" className="text-brand-cyan-deep font-semibold hover:underline">
                start a free trial
              </Link>{" "}
              and explore the product now.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5">
            {[...kaizen, ...others].map((c) => (
              <Link
                key={c.slug}
                href={`/knowledge-base/${c.slug}`}
                className="group glass-card rounded-2xl border border-border/60 p-6 flex flex-col hover:border-brand-cyan/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-full">
                    {c.series}
                    {c.episodeNo != null ? ` #${c.episodeNo}` : ""}
                  </span>
                  {c.readMinutes ? (
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="size-3" /> {c.readMinutes} min
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-3 font-extrabold text-lg text-foreground leading-snug group-hover:text-primary transition-colors">
                  {c.title}
                </h2>
                {c.hook && <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{c.hook}</p>}

                {c.questions.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {c.questions.slice(0, 3).map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <HelpCircle className="size-3.5 text-brand-cyan mt-0.5 shrink-0" />
                        <span>{q}</span>
                      </li>
                    ))}
                    {c.questions.length > 3 && (
                      <li className="text-[11px] text-muted-foreground/70 pl-5">
                        +{c.questions.length - 3} more
                      </li>
                    )}
                  </ul>
                )}

                {c.modules.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {c.modules.slice(0, 4).map((m) => (
                      <span key={m} className="text-[10px] rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-muted-foreground">
                        {m}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-border/40 flex items-center justify-between text-sm font-semibold">
                  <span className="text-brand-cyan-deep inline-flex items-center gap-1.5">
                    Read the walkthrough <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
