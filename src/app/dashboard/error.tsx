"use client";

/**
 * Dashboard error boundary. Catches any runtime error thrown while rendering a
 * /dashboard/* page (a failed query, a null deref) and shows a calm recovery
 * screen with a "Try again" button instead of crashing to Next's raw error
 * page. The persistent layout (sidebar/topbar) stays mounted around it.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, Home } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console (and any client error reporter) for debugging.
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="max-w-lg mx-auto mt-12 card-elevated p-10 text-center">
      <div className="size-16 mx-auto rounded-2xl bg-rose-100 grid place-items-center shadow-md">
        <AlertTriangle className="size-8 text-rose-600" />
      </div>
      <h1 className="text-2xl font-bold mt-5 tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        This page hit an unexpected error. It&apos;s been logged. You can retry, or head back
        to your dashboard.
      </p>
      {error?.digest && (
        <p className="mt-3 text-[11px] text-muted-foreground font-mono">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-2 justify-center">
        <button onClick={reset} className="btn-primary">
          <RotateCw className="size-4" /> Try again
        </button>
        <Link href="/dashboard" className="btn-secondary">
          <Home className="size-4" /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
