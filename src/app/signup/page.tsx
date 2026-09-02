"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthScreen } from "@/components/auth/AuthScreen";

export default function SignupPage() {
  return (
    <ToastProvider>
      <Suspense
        fallback={
          <div className="min-h-screen grid place-items-center bg-secondary/20">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        }
      >
        <AuthScreen initialMode="signup" />
      </Suspense>
    </ToastProvider>
  );
}
