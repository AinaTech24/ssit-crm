/**
 * PUBLIC KAIZEN article.
 *
 *   Anyone → the full article: scenario, questions, walkthrough, screenshots.
 *
 * FULLY PUBLIC — scenario, walkthrough and screenshots all render for anonymous
 * visitors. A non-blocking CTA at the end offers the trial.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Clock, HelpCircle, CheckCircle2, ImageIcon } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { loadArticle, loadKbCards } from "@/lib/kb/articles";
import { PublicShell } from "@/components/kb/PublicShell";
import { Markdown } from "@/components/ai/Markdown";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // Metadata is public-only — never include gated content here.
  const a = await loadArticle(slug);
  if (!a) return { title: "Not found | Equitywala" };
  const t = a.seoTitle || `${a.title} | KAIZEN — Equitywala`;
  const d =
    a.seoDescription ||
    a.hook ||
    `A real MFD scenario and how Equitywala handles it — ${a.title}.`;
  return {
    title: t,
    description: d,
    alternates: { canonical: `/knowledge-base/${a.slug}` },
    openGraph: { title: t, description: d, type: "article" },
  };
}

export default async function KbArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession().catch(() => null);
  const signedIn = !!session;
  const a = await loadArticle(slug);
  if (!a) notFound();

  const more = (await loadKbCards()).filter((c) => c.slug !== a.slug).slice(0, 4);

  return (
    <PublicShell signedIn={signedIn}>
      <article className="max-w-3xl mx-auto px-6 pt-10 pb-4">
        <Link
          href="/knowledge-base"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="size-4" /> All KAIZEN entries
        </Link>

        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-full">
            {a.series}
            {a.episodeNo != null ? ` #${a.episodeNo}` : ""}
          </span>
          {a.readMinutes ? (
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="size-3" /> {a.readMinutes} min read
            </span>
          ) : null}
          {a.publishedAt ? (
            <span className="text-[11px] text-muted-foreground">
              {new Date(a.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          ) : null}
        </div>

        <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground leading-tight">
          {a.title}
        </h1>
        {a.hook && <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{a.hook}</p>}

        {a.modules.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {a.modules.map((m) => (
              <span key={m} className="text-[10px] rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-muted-foreground">
                {m}
              </span>
            ))}
          </div>
        )}

        {/* ── PUBLIC: the scenario ── */}
        <section className="mt-9">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">The situation</h2>
          <div className="mt-3 text-[15px] leading-relaxed text-foreground/90">
            <Markdown text={a.scenarioMd} />
          </div>
        </section>

        {/* ── PUBLIC: the questions ── */}
        {a.questions.length > 0 && (
          <section className="mt-8 rounded-2xl border border-border/60 bg-secondary/20 p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              The questions this raises
            </h2>
            <ul className="mt-3 space-y-2.5">
              {a.questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[15px] text-foreground/90">
                  <HelpCircle className="size-4 text-brand-cyan mt-1 shrink-0" />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── The answer — PUBLIC, no login required ── */}
        <section className="mt-10">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-emerald-600" /> How Equitywala handles it
          </h2>
          <div className="mt-3 text-[15px] leading-relaxed text-foreground/90">
            <Markdown text={a.solutionMd} />
          </div>
        </section>

        {a.screenshots.length > 0 && (
          <section className="mt-10 space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
              <ImageIcon className="size-4 text-brand-cyan" /> From inside the product
            </h2>
            {a.screenshots.map((s) => (
              <figure key={s.index} className="rounded-xl border border-border/60 overflow-hidden bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/kb/image/${a.id}?i=${s.index}`}
                  alt={s.alt || s.caption || `${a.title} — screenshot ${s.index + 1}`}
                  className="w-full h-auto block"
                  loading="lazy"
                />
                {s.caption && (
                  <figcaption className="text-xs text-muted-foreground px-4 py-2.5 border-t border-border/40">
                    {s.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </section>
        )}

        {/* Non-blocking CTA — the article is free; this just offers the next step. */}
        <div className="mt-10 rounded-2xl border-2 border-primary/25 bg-primary/[0.03] p-6 text-center">
          <div className="font-bold text-foreground">Want this running on your own book?</div>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            {signedIn
              ? "Open the module and try it with your own clients."
              : "Start a free trial and set it up with your own data — no card required."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {signedIn ? (
              <Link href="/dashboard" className="btn-primary text-sm font-semibold">
                Open my dashboard <ArrowRight className="size-4" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-primary text-sm font-semibold">
                  Log in <ArrowRight className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </article>

      {/* More in the series */}
      {more.length > 0 && (
        <section className="max-w-3xl mx-auto px-6 mt-14">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">More in the series</h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            {more.map((c) => (
              <Link
                key={c.slug}
                href={`/knowledge-base/${c.slug}`}
                className="rounded-xl border border-border/60 bg-card p-4 hover:border-brand-cyan/50 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  {c.series}
                  {c.episodeNo != null ? ` #${c.episodeNo}` : ""}
                </span>
                <div className="font-semibold text-sm mt-1 leading-snug">{c.title}</div>
                {c.hook && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.hook}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </PublicShell>
  );
}
