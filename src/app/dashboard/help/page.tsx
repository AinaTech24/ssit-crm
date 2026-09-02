"use client";

/**
 * /dashboard/help — the in-app glossary + quick-start guide.
 *
 * Goal: a non-technical MFD can look up any term they see in the app
 * (ARN, KYC, UCC, NAV, etc.) without leaving the dashboard. Live search
 * filter so they don't need to scroll a long list.
 *
 * Includes:
 *   1. Search box (filters glossary in real-time)
 *   2. Glossary grouped by category
 *   3. "How do I…" quick links to common tasks
 *   4. Support contact tile (email + WhatsApp)
 */
import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  BookOpen,
  Sparkles,
  Users,
  MessageSquare,
  ShieldCheck,
  Mail,
  Phone,
  Rocket,
  ArrowRight,
} from "lucide-react";
import { GLOSSARY } from "@/lib/help/glossary";

const CATEGORY_ORDER = [
  "Identifiers",
  "Regulatory",
  "Products",
  "Operations",
  "Marketing",
] as const;

const HOW_DO_I = [
  {
    icon: Sparkles,
    title: "Add my first lead",
    body: "A lead is someone interested but not yet invested. Click + at the top of the Leads page, fill in name and phone, save.",
    href: "/dashboard/leads/new",
  },
  {
    icon: Users,
    title: "Convert a lead to a client",
    body: "Open the lead, click Convert. The system carries over the risk profile, proposals and any documents you've collected.",
    href: "/dashboard/leads",
  },
  {
    icon: MessageSquare,
    title: "Send a WhatsApp message",
    body: "Pick a template (or design your own), choose recipients. We automatically attach your ARN tagline so it stays SEBI-compliant.",
    href: "/dashboard/communications",
  },
  {
    icon: ShieldCheck,
    title: "Run a risk profile",
    body: "From the lead/client detail, click Send risk profile link. Client fills the form on their phone. Score is saved against the profile.",
    href: "/dashboard/risk-profiles",
  },
  {
    icon: Rocket,
    title: "Turn on automation",
    body: "Workflow Rules let you do things like 'Send a follow-up WhatsApp 2 days after a SIP rejection'. We've pre-built 25 recipes.",
    href: "/dashboard/workflows/rules",
  },
];

export default function HelpPage() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    const entries = Object.entries(GLOSSARY);
    if (!needle) return entries;
    return entries.filter(
      ([term, entry]) =>
        term.toLowerCase().includes(needle) ||
        entry.short.toLowerCase().includes(needle) ||
        (entry.long ?? "").toLowerCase().includes(needle)
    );
  }, [needle]);

  const grouped = useMemo(() => {
    const out: Record<string, typeof filtered> = {};
    for (const [term, entry] of filtered) {
      (out[entry.category] ??= []).push([term, entry]);
    }
    return out;
  }, [filtered]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="page-title">
          <BookOpen className="size-6 text-brand-cyan" /> Help &amp; glossary
        </h1>
        <p className="page-subtitle">
          Plain-English explanations for every term, plus quick guides for the
          most common tasks.
        </p>
      </div>

      {/* How do I... */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
          How do I…
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {HOW_DO_I.map((h, i) => {
            const Icon = h.icon;
            return (
              <Link
                key={i}
                href={h.href}
                className="card-elevated p-4 hover:shadow-lg transition-shadow group"
              >
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-brand-cyan-light text-brand-cyan-deep grid place-items-center flex-shrink-0">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      {h.title}
                      <ArrowRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {h.body}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Glossary */}
      <section>
        <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Glossary
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {Object.keys(GLOSSARY).length} terms, explained simply.
            </p>
          </div>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ARN, KYC, NAV…"
              className="pl-9 pr-3 py-2 text-sm border border-input rounded-lg bg-background w-64 focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card-elevated p-8 text-center text-sm text-muted-foreground">
            No matches for &ldquo;{q}&rdquo;. Try a different word, or{" "}
            <a href="mailto:support@ssit.com" className="text-brand-cyan hover:underline">
              ask support
            </a>
            .
          </div>
        ) : (
          <div className="space-y-5">
            {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
              <div key={cat}>
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-brand-cyan-deep mb-2">
                  {cat}
                </h3>
                <div className="card-elevated divide-y divide-border/60">
                  {grouped[cat].map(([term, entry]) => (
                    <div
                      key={term}
                      id={term.toLowerCase()}
                      className="px-5 py-4 hover:bg-secondary/40 transition-colors"
                    >
                      <div className="font-bold text-sm tracking-wide text-foreground">
                        {term}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {entry.short}
                      </p>
                      {entry.long && (
                        <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed border-l-2 border-border pl-3">
                          {entry.long}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Support tile */}
      <section className="card-elevated p-5 brand-soft">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl brand-gradient text-white grid place-items-center flex-shrink-0 shadow-md">
            <MessageSquare className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Still stuck? Talk to a human.</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Our support team replies in under 2 hours during business hours
              (Mon–Sat, 10 AM–7 PM IST).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="mailto:support@ssit.com"
                className="btn-secondary text-xs"
              >
                <Mail className="size-3.5" /> support@ssit.com
              </a>
              <a
                href="https://wa.me/918200770942"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs"
              >
                <Phone className="size-3.5" /> WhatsApp us
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
