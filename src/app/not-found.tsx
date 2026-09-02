import Link from "next/link";
import { Compass, ArrowLeft } from "lucide-react";

/**
 * Branded 404. Replaces Next's bare "This page could not be found" with an
 * on-brand screen + a clear way back. Rendered for any unmatched route across
 * the whole app (marketing, dashboard, super-admin).
 */
export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center brand-soft p-6">
      <div className="text-center max-w-md animate-fade-in">
        <Link href="/" className="inline-flex items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ssit-wordmark.png" alt="SSIT CRM" className="h-8 w-auto" />
        </Link>

        <div className="size-20 mx-auto rounded-2xl bg-card border shadow-sm grid place-items-center">
          <Compass className="size-10 text-brand-cyan" />
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight mt-6">404</h1>
        <p className="text-muted-foreground mt-2 leading-relaxed">
          We couldn&apos;t find that page. It may have moved, or the link is out of date.
        </p>
        <div className="mt-6 flex gap-2 justify-center">
          <Link href="/dashboard" className="btn-primary">
            <ArrowLeft className="size-4" /> Go to dashboard
          </Link>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
