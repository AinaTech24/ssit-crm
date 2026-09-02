/**
 * Header + footer for the public Knowledge Base pages, matching the landing
 * page's chrome so /knowledge-base doesn't look like a different product.
 * Server component — no interactivity needed.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function PublicShell({
  children,
  signedIn = false,
}: {
  children: React.ReactNode;
  signedIn?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="inline-flex items-center hover:opacity-90 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ssit-logo.png"
              alt="SSIT CRM — mutual fund software for distributors"
              className="h-8 w-auto object-contain shrink-0"
            />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-muted-foreground">
            <Link href="/knowledge-base" className="text-primary">Knowledge Base</Link>
            <Link href="/#features" className="hover:text-primary transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-primary transition-colors">Pricing</Link>
            <Link href="/#faq" className="hover:text-primary transition-colors">FAQ</Link>
          </nav>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <Link href="/dashboard" className="btn-primary text-sm font-semibold">
                Go to dashboard <ArrowRight className="size-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-semibold px-4 py-2 rounded-lg hover:bg-secondary text-foreground/80 hover:text-foreground transition-all"
                >
                  Log in
                </Link>
                <Link href="/signup" className="btn-primary text-sm font-semibold">
                  Start free trial <ArrowRight className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/40 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} SSIT Tech. Built for Indian Mutual Fund Distributors.</span>
          <div className="flex items-center gap-5">
            <Link href="/knowledge-base" className="hover:text-foreground">Knowledge Base</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
