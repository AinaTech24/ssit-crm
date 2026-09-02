"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthScreen } from "@/components/auth/AuthScreen";

/** Client wrapper for the login screen — receives white-label branding resolved
 *  server-side from the request host (a firm's subdomain / custom domain). */
export function AuthShell({
  brandLogoUrl,
  brandName,
}: {
  brandLogoUrl?: string | null;
  brandName?: string | null;
}) {
  return (
    <ToastProvider>
      <Suspense
        fallback={
          <div className="min-h-screen grid place-items-center bg-secondary/20">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        }
      >
        <AuthScreen initialMode="login" brandLogoUrl={brandLogoUrl} brandName={brandName} />
      </Suspense>
    </ToastProvider>
  );
}
