/**
 * Shared chrome + typography for the public legal pages (/terms, /privacy,
 * /refund). Server component — pure static content, no client JS.
 */
import Link from "next/link";
import { LEGAL } from "@/lib/legal/company";

export function LegalShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-5 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            {LEGAL.brand}
          </Link>
          <nav className="flex gap-5 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/refund" className="hover:text-foreground">Refunds</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: {LEGAL.lastUpdated}</p>
        {intro ? <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{intro}</p> : null}

        <article className="mt-6">{children}</article>

        <footer className="mt-14 border-t pt-6 text-xs text-muted-foreground space-y-1">
          <p>
            {LEGAL.legalEntity} · {LEGAL.address}
            {LEGAL.gstin ? ` · GSTIN ${LEGAL.gstin}` : ""}
          </p>
          <p>
            {LEGAL.brand} is a software platform for SEBI-registered mutual fund distributors. It does not
            provide investment advice and is not a broker, exchange, or registered investment adviser.
          </p>
        </footer>
      </main>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-foreground mt-8 mb-2">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mt-2">{children}</p>;
}

export function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground mt-2">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
